// CityScene `City` (plan.md §7; city-view.md §1-§3, §5.2, §6, §10, §11.2):
// the isometric city. Owns the ground bake (fogged `_locked` ground for locked
// regions), ONE world Layer depth-sorted by tx + ty (buildings, props, the
// warehouse exterior with its dock lights, the days-since-incident sign,
// smoke, district labels / lock signs, vehicles, badges, popups, tooltip),
// the CameraRig + GestureClassifier, the zone highlight, follow mode and the
// city side of the city → warehouse transition (nav.ts WorldTransition).
//
// M2 (city-view §3.2-§3.3): parcel:flagged pings the warehouse roof; a Toss
// stamps DEFUSED +$50 (gold, 2-px shake) or OOPS −$25 (grey) over it; a lost
// life shakes the camera (300 ms, 0.004), plays fx_boom on the destination
// and scorches it for one in-game day, and cracks the days-since-incident
// sign (sign_days_cracked while the counter is 0 after a loss, Q33). The
// shakes are skipped under prefers-reduced-motion. Scorch and sign are also
// rebuilt from sim state (lastLostLife, daysSinceIncident) on wake / swap,
// since sim events are not delivered while the city sleeps.
//
// M3 (plan.md §12.6 tasks 5, 9, 10; city-view §1.4, §2, §9.6): region:unlocked
// crossfades the district's `_locked` buildings/props to their colour frames
// and a second ground bake over the old one (1 s), then the lock sign pops
// and the smoke emitters start; level:up covers the warehouse with fx_dust
// (4 × 250 ms), swaps it to wh_ext_t<tier> on the reveal frame and floats the
// gold "LEVEL 2 — LOCAL" stamp off the roof (the sting is the AudioDirector's
// own level:up hook; no auto-pan). Waking after either snaps to the new state
// (tier 2 at once). Mood overlays per building (flower boxes ≥ 80, shutters
// < 30), the angry label + a grumble ui:sfx every 20 s while on screen, the
// honking queue + red dock lights, docked vehicles drawn in front of bay 1
// (the exterior frame's dockPose, cityFx.ts warehouseAnchors), the six Industrial smoke emitters while
// Industrial is live, and the render-quality cut order (quality.ts, R4).
//
// M4 bug hunt: vehicles in front of a multi-tile footprint sort above it
// (vehicleDepth.ts — along the back of a 3×3 face the wall clipped them); a
// vehicle hidden behind a building neither swallows the tap meant for that
// building nor gets followed by a double-tap there, and a district plate or
// lock board (drawn over everything) picks its district (the pick resolves
// what the player sees); the ground bake's texture is removed on SHUTDOWN
// (a New game after a region unlock left the 3072×1536 'ground_b' behind).
//
// Build 2 / M5 (B2 §5, §6.3): the Title runs above this scene in ATTRACT
// mode (start data {attract: true}): the Title's attract sim drives it, the
// scene's input is off (no gestures, keys, hover, tooltip), nothing emits a
// ui:sfx, and src/render/AttractCamera.ts tours the lot and the live regions
// (12-s legs, 1-s holds, zoom 1). endAttract() (Continue / New game) fades
// the camera out, hands over to the Title's swap (setSim(real) → syncAll,
// the ground re-baked for the real lock state), drops every attract-only
// view, puts the camera on the warehouse, turns input on, fades back in and
// emits pm:attractEnd (what __pm.ready waits for). recycleAttract() (the
// Title, every 30 min of attract sim time or on a lost life) re-installs the
// demo snapshot under the same fade, the tour going on; a lost life in
// attract mode never shakes the camera behind the logo, and the fps sampler
// does not judge the Title (quality.ts skip). Parcel hops (F4): the
// pickup hop ends inside the vehicle body (v.y − 4) and sinks to scale 0 over
// its last 40 % (Popups.hop {sink}); the delivery hop starts from the body
// at full size. Debug: setLotCorners() marks the lot footprint's four iso
// corners (the city-lot-zoom2 shot).
//
// M7 (spec-build2 §3.3, design-m7 §6.8): while the golden parcel is alive
// its origin A and destination B both wear the gold `ic_magic` with the
// `magic_ring_<step>` draining with the quest's countdown (empty once it is
// over — late, failed or abandoned; cityFx.magicMarkers over the active
// quest and QuestsView.magic) (BuildingView.setMagic), refreshed on
// quest:accepted / completed / failed (on the next frame, once the sim's
// revision has moved), every REFRESH_MS and on syncAll; the previous pair
// is cleared. Its pickup and delivery
// hops fly `ic_magic` instead of `ic_parcel_s` (cityFx.hopIcon).
//
// M8 (spec-build2 §4.1, design-m8-m9 §6.2): the Docks unlock through the
// same crossfade (dk_terminal_a/_b, dk_port_office in colour). One CityHubView
// per map.hubs row (src/render/cityHub.ts): the 45-s clearance ring over
// the office (dk_customs → dk_port_office, `×N` from 2 parcels) and the
// dk_ship prop sailing its `exit` off the map edge on hub:departure (4 s
// out, 10 s away, 4 s back; ignored while away). parcel:handedOff hops the
// parcel from the vehicle at the pier anchor into the pier with a grey
// `LOCKED $18`; parcel:cleared stamps gold `CLEARED +$18` (red `SHIP HAS
// SAILED` for malware) at the office. Docks 2–3: the bay lights by dock
// NUMBER (lamp k for dock k + 1; t3 draws two), and docked vehicles stand
// before their own bay (cityFx.dockRunBlend over lot.docks 1..n, poses per
// bay from the exterior frame); dock:bought extends the run and pops the
// new lamp.
//
// M9 (spec-build2 §4.2–§4.3, design-m8-m9 §6.2): L4 opens Low-density +
// Rural and L5 the Airport + Park & civic through the same crossfade (both
// regions of a level are live before the first region:unlocked, so one fade
// and one ground re-bake carry the pair); every one of their buildings has
// its own sprite + `_locked` twin, the fence / hay_bale / fountain / plane /
// tower props too, and the runway scenery fogs with the Airport
// (cityFx.groundRegionAt). The Airport's CityHubView is the map.hubs row's:
// the 20-s ring on ap_terminal and ap_plane taxiing east off the map edge,
// climbing and fading out on hub:departure, fading back in at its stand.
// Clearance stamps rise from above the office's ring (cityHub
// clearStampPoint). level:up 4 / 5 swaps the exterior to wh_ext_t4 / _t5
// (three bays: three lamps and three docked poses, dock 3 lit by number).
//
// Build 3 M12 (B3 §3.5–§3.6): a vehicle an event took (`vehicle:lost`)
// leaves under an fx_puff (the sold vehicle's fx_pop is a sale); the OOPS
// stamp names the fee the sim actually takes (the wrongTossFee modifier
// folded in, clamped to the balance — HoldBayCard wrongTossFeeNow); an
// event life (`life:lost {cause: 'event'}`) has no building to flash.
//
// Sim contract: reads the ViewSim facade only, never mutates state; commands
// go through the facade (rush). Sim events are bound with bindSim
// (attached on create/WAKE, detached on SLEEP/SHUTDOWN, syncAll on wake).
// Game events: emits pm:view, pm:select, pm:follow, pm:goto, ui:tap,
// ui:sfx; consumes pm:follow, pm:zonePick, pm:panTo.
import Phaser from 'phaser'
import {
  ATTRACT_FADE_MS,
  EV_ATTRACT_END,
  EV_GOTO,
  EV_VIEW,
  FADE_IN_MS,
  FADE_OUT_MS,
  FADE_RGB,
  PAN_TO_WAREHOUSE_MS,
  REG_CITY_CAM,
  type CityStartData,
  type StoredCam,
  type WorldTransition,
  type WorldView,
} from '../boot/nav.ts'
import {
  bindSim,
  getAlpha,
  getSim,
  getStepper,
  getViewSim,
  REG,
} from '../boot/simBinding.ts'
import { simStopped } from '../boot/stepper.ts'
import {
  blockRect,
  mapBlockAt,
  type DistrictDef,
  type GameData,
} from '../data/index.ts'
import { GestureClassifier } from '../input/GestureClassifier.ts'
import { WORLD_ATLAS, FONT_KEY } from '../render/atlases.ts'
import { AttractCamera, attractStops } from '../render/AttractCamera.ts'
import {
  BuildingView,
  capTop,
  DEPTH,
  LOCKED_FILL,
  visibleRect,
} from '../render/BuildingView.ts'
import { CameraRig } from '../render/CameraRig.ts'
import {
  BAY_LIGHTS,
  bayLightShown,
  CONSTRUCTION_SWAP_MS,
  DOCK_POSE_DEPTH,
  dockPoseCanvas,
  dockRunRadius,
  dustFrame,
  fadeK,
  hopIcon,
  levelStampText,
  magicMarkers,
  maxDockNumber,
  moodFor,
  SMOKE_PHASE_MS,
  SMOKE_PUFFS,
  signCracked,
  signDaysText,
  smokePuff,
  stampPose,
  UNLOCK_FADE_MS,
  WH_ANCHOR_FRAME,
  WH_CANVAS,
  warehouseAnchors,
} from '../render/cityFx.ts'
import {
  clearedStampText,
  clearStampPoint,
  handOffVehicleId,
  CityHubView,
  lockedStampText,
  lostStampText,
  stampSum,
  type StampSum,
} from '../render/cityHub.ts'
import { decayPhase } from '../render/decayPhase.ts'
import { DistrictLabel } from '../render/DistrictLabel.ts'
import {
  frameOrNull,
  lockedFrame,
  SIGN_FACE,
  SMOKE_ANCHORS,
  buildingSprite,
} from '../render/frames.ts'
import {
  bakeGround,
  GROUND_Y,
  nextGroundKey,
  type GroundBake,
} from '../render/ground.ts'
import {
  footprintAnchor,
  footprintDepth,
  HH,
  HW,
  originX,
  pickTile,
  tileToScreen,
  worldSize,
} from '../render/iso.ts'
import {
  EV_QUALITY,
  installQuality,
  qualityFlags,
  type QualityController,
  type QualityFlags,
} from '../render/quality.ts'
import {
  sortDepth,
  type Occluder,
  type SpriteRect,
} from '../render/vehicleDepth.ts'
import { VehicleView, type DockPose } from '../render/VehicleView.ts'
import type { CommandResult } from '../sim/commands.ts'
import type { LifeLostPayload, SimEventPayloads } from '../sim/events.ts'
import { TICKS_PER_DAY, TICKS_PER_S } from '../sim/types.ts'
import type { ViewSim } from '../sim/view-api.ts'
import {
  BuildingTooltip,
  type ClampRect,
  type RushLine,
  type TooltipModel,
} from '../ui/BuildingTooltip.ts'
import { hubTip } from '../ui/hubText.ts'
import { computeLayout, type Layout } from '../ui/layout.ts'
import { keysBlocked } from '../ui/Sheet.ts'
import {
  MERGE_MS,
  Popups,
  STAMP_GOLD,
  STAMP_GREY,
  STAMP_RED,
  type ViewRect,
} from '../ui/Popups.ts'
import { FONT_SIZE, FONT_SIZE_BIG, paletteColour, THEME } from '../ui/theme.ts'
import { oopsStampText, wrongTossFeeNow } from '../ui/warehouse/HoldBayCard.ts'

// Game-event names this scene speaks (plan.md §5; the M1 cross-scene contract).
export const EV_SELECT = 'pm:select'
export const EV_FOLLOW = 'pm:follow'
export const EV_ZONE_PICK = 'pm:zonePick'
export const EV_PAN_TO = 'pm:panTo'
export const EV_UI_TAP = 'ui:tap'
export const EV_UI_SFX = 'ui:sfx'

export type SelectPayload = {
  kind: 'district' | 'locked' | 'building' | 'vehicle'
  id: string | number
}
export type FollowPayload = { vehicleId: number | null }
export type ZonePickPayload = { districtId: string | null }
/**
 * pm:panTo target. `cover` (optional extension, 0..1) is the fraction of the
 * screen height covered from the bottom by an open sheet: the target is then
 * centred in the uncovered top part (district panel 0.5, Garage 0.6).
 */
export type PanToPayload = (
  | { vehicleId: number }
  | { regionId: string }
  | { buildingId: string }
) & { cover?: number }

/** Headroom above / below the map for tall sprites (city-view.md §1.2). */
const MAP_TOP_PAD = 64
const MAP_BOTTOM_PAD = 128
/** Badge / bell / tooltip refresh rate (city-view §1.3: 2 Hz). */
const REFRESH_MS = 500
/** Arrow keys pan this many screen px per frame while held (§10). */
const KEY_PAN_PX = 32
const HOVER_MS = 400
const LIGHT_BLINK_MS = 250
const ZONE_PULSE_MS = 1000
/** Tint of the zone highlight's block fill under the pulsing outline. */
const ZONE_FILL_ALPHA = 0.18
/** Rise of a pickup / delivery popup's spawn point over the doorstep. */
const POPUP_LIFT = 30
/** The attract → game swap happens anyway if the fade never reports back (scene clock). */
const ATTRACT_SWAP_TIMEOUT_MS = 1000
/** Debug lot-corner marks (setLotCorners): colour, arm length. */
const LOT_CORNER_COLOUR = 0xff00ff
const LOT_CORNER_ARM = 4
/** fx strips (4 frames each). */
const FX_POP_MS = 250
/** Build 3 M12: a vehicle an event took leaves under fx_puff_f0..f3. */
const FX_LOST_MS = 400
const FX_PING_MS = 300
/** city-view §3.3: fx_boom is 6 frames over 480 ms. */
const FX_BOOM_MS = 480
const FX_BOOM_FRAMES = 6
/** city-view §3.2-§3.3 camera shakes (duration ms, intensity). */
const SHAKE_DEFUSED: readonly [number, number] = [120, 0.002]
const SHAKE_LOST_LIFE: readonly [number, number] = [300, 0.004]
/** The new ground bake fades in above the old one at this depth (§1.4). */
const GROUND_FADE_DEPTH = -0.5
/** The fx_dust cloud draws over the warehouse sprite (its depth + this). */
const DUST_DEPTH = 0.5
/** The level stamp: over every popup; 2-px shadow at 32 px (2× m5x7). */
const STAMP_DEPTH = DEPTH.popup + 1
const STAMP_SHADOW = 2
const STAMP_PILL_H = 26
const STAMP_PILL_PAD = 6
/** Stamp start: this far below the exterior's visible top. */
const STAMP_FROM_TOP = 12

type Pick =
  | { kind: 'building'; view: BuildingView }
  | { kind: 'warehouse' }
  | { kind: 'locked'; district: string }
  | { kind: 'district'; district: string }
  | { kind: 'none' }

interface Fx {
  img: Phaser.GameObjects.Image
  frames: string[]
  start: number
  ms: number
}

interface Smoke {
  building: string
  puffs: Phaser.GameObjects.Image[]
  /** Chimney top (world px). */
  x: number
  y: number
  phaseMs: number
}

/** A crossfade (region unlock, §1.4): `ins` 0 → 1, `outs` 1 → 0 then destroyed. */
interface Fade {
  ins: Phaser.GameObjects.Image[]
  outs: Phaser.GameObjects.Image[]
  start: number
  ms: number
  done?: () => void
}

/** The level-up construction overlay (§9.6). */
interface Construction {
  start: number
  tier: number
  dust: Phaser.GameObjects.Image[]
  swapped: boolean
}

interface LevelStamp {
  start: number
  box: Phaser.GameObjects.Container
  y: number
}

interface PropView {
  frame: string
  region: string
  /** The map.props tile (map.hubs finds its vessel by it). */
  tile: readonly [number, number]
  img: Phaser.GameObjects.Image | null
  x: number
  y: number
  depth: number
}

const RUSH_FAIL_TEXT: Partial<Record<string, string>> = {
  'trucks-only': 'Trucks only',
  'needs-van': 'Needs a van',
  'no-vehicle': 'No vehicle free — flagged',
}

/** Map prop kinds the manifest renamed (artCore hand-off: lamp → lamp_post). */
const PROP_ALIAS: Partial<Record<string, string>> = { lamp: 'lamp_post' }

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export class CityScene extends Phaser.Scene implements WorldTransition {
  private vs!: ViewSim
  private gd!: GameData
  private ox = 0
  private world!: Phaser.GameObjects.Layer
  private ground: GroundBake | null = null
  private rig!: CameraRig
  private gestures!: GestureClassifier
  private L!: Layout
  private popups!: Popups
  private tooltip!: BuildingTooltip
  private hasFont = false

  private buildings = new Map<string, BuildingView>()
  private byDistrict = new Map<string, BuildingView[]>()
  private vehicles = new Map<number, VehicleView>()
  private labels = new Map<string, DistrictLabel>()
  private props: PropView[] = []
  /** Multi-tile footprints a vehicle can pass in front of (vehicleDepth.ts). */
  private occluders: Occluder[] = []
  private smoke: Smoke[] = []
  private fx: Fx[] = []
  private fades: Fade[] = []
  private groundFading = false
  private construction: Construction | null = null
  private levelStamp: LevelStamp | null = null
  private dockPose: DockPose | null = null
  /** M8: one per map.hubs row (the clearance ring + the vessel's trips). */
  private hubViews = new Map<string, CityHubView>()
  /** M8: the dollars of the hub stamps inside the Popups merge window, per key. */
  private stampSums = new Map<string, StampSum>()
  private qualityCtl: QualityController | null = null
  /** Set while SHUTDOWN lands the in-flight fades (no new sprites then). */
  private shuttingDown = false
  private quality: QualityFlags = qualityFlags(0)
  private districts = new Map<string, DistrictDef>()
  private regionColour = new Map<string, number>()
  /** District id → fogged, as last applied to the view. */
  private lockState = new Map<string, boolean>()

  private warehouse: Phaser.GameObjects.Image | null = null
  private warehouseAnchor = { x: 0, y: 0 }
  private warehouseTier = 0
  private dockLights: Phaser.GameObjects.Image[] = []
  /** Lamps on the current exterior frame (t3 has two bays): extra lights hide. */
  private bayLightCount = Number.POSITIVE_INFINITY
  private signText: Phaser.GameObjects.BitmapText | null = null
  private sign: Phaser.GameObjects.Image | null = null
  /** Scorched building id → the tick its one-day scorch ends (§3.3). */
  private scorched = new Map<string, number>()
  private zone: Phaser.GameObjects.Graphics | null = null
  private zoneDistrict: string | null = null

  private dirty = new Set<string>()
  /** M7: buildings wearing the magic marker (A, B), and a refresh is due. */
  private magicIds: string[] = []
  private magicDirty = false
  private refreshAcc = 0
  private queueN = 0
  private stalled = false
  private followId: number | null = null
  private transitioning = false
  private popOnCreate = new Set<number>()
  /** Last rush outcome shown in the tooltip, per building. */
  private tipRush: {
    buildingId: string
    kind: 'failed' | 'already'
    text: string
  } | null = null
  private hover: { x: number; y: number; since: number; done: boolean } | null =
    null
  /** Arrow keys only (Space/1/2/W/G/Esc belong to the HUD, §10). */
  private cursors: Record<
    'up' | 'down' | 'left' | 'right',
    Phaser.Input.Keyboard.Key
  > | null = null
  private readonly viewRect: ViewRect = {
    contains: (x, y) => this.cameras.main.worldView.contains(x, y),
  }
  /** The Title's attract city (B2 §5): see the header. */
  attract = false
  private attractCam: AttractCamera | null = null
  /** endAttract() in flight (the fade before the swap). */
  private leavingAttract = false
  /** recycleAttract() in flight (the fade before the snapshot re-install). */
  private recyclingAttract = false
  /** Debug: the lot footprint's corner marks (setLotCorners). */
  private lotCorners: Phaser.GameObjects.Graphics | null = null

  constructor() {
    super('City')
  }

  init(data: CityStartData = {}): void {
    this.attract = data?.attract === true
    this.attractCam = null
    this.leavingAttract = false
    this.recyclingAttract = false
    this.lotCorners = null
    this.buildings = new Map()
    this.byDistrict = new Map()
    this.vehicles = new Map()
    this.labels = new Map()
    this.props = []
    this.occluders = []
    this.smoke = []
    this.fx = []
    this.fades = []
    this.groundFading = false
    this.construction = null
    this.levelStamp = null
    this.dockPose = null
    this.hubViews = new Map()
    this.stampSums = new Map()
    this.shuttingDown = false
    this.lockState = new Map()
    this.dirty = new Set()
    this.magicIds = []
    this.magicDirty = false
    this.popOnCreate = new Set()
    this.dockLights = []
    this.warehouse = null
    this.warehouseTier = 0
    this.sign = null
    this.signText = null
    this.scorched = new Map()
    this.zone = null
    this.zoneDistrict = null
    this.ground = null
    this.followId = null
    this.transitioning = false
    this.tipRush = null
    this.hover = null
    this.refreshAcc = 0
    this.queueN = 0
    this.stalled = false
  }

  create(): void {
    this.vs = getViewSim(this)
    this.gd = this.vs.data
    const map = this.gd.map
    const [mapW, mapH] = map.size
    this.ox = originX(mapH)
    this.hasFont = this.cache.bitmapFont.has(FONT_KEY)
    for (const d of this.gd.districts) this.districts.set(d.id, d)
    for (const r of map.regions)
      this.regionColour.set(r.id, paletteColour(r.colour))
    this.relayout()
    // Render quality (plan.md R4): boot level from the core count + the fps
    // sampler; idempotent, so a restarted City reuses the game's controller.
    // The attract Title (idle time, sample decode, the swap's re-bake) is
    // not judged: the sampler skips — and restarts its window — while the
    // attract sim is the game's.
    this.qualityCtl = installQuality(this.game, {
      skip: () => this.registry.get(REG.attractSim) != null,
    })
    this.quality = this.qualityCtl.flags

    this.world = this.add.layer()
    for (const d of this.gd.districts)
      this.lockState.set(d.id, this.isLockedNow(d.id))
    this.ground = bakeGround(this, map, {
      isLocked: (id) => this.lockState.get(id) === true,
    })
    this.world.add(this.ground.image)
    this.buildStatics()
    this.popups = new Popups(this, this.world)
    this.popups.setCapacity(this.quality.popupPool)
    this.tooltip = new BuildingTooltip(this, this.world)

    const ws = worldSize(mapW, mapH)
    this.rig = new CameraRig(
      this.cameras.main,
      0,
      GROUND_Y - MAP_TOP_PAD + HH,
      ws.w,
      ws.h + MAP_TOP_PAD + MAP_BOTTOM_PAD,
    )
    const wc = this.warehouseCentre()
    this.focusOn(wc.x, wc.y, 0)

    this.installInput()
    this.installGameEvents()

    bindSim(
      this,
      {
        'parcel:spawned': (p) => this.dirty.add(p.origin),
        'parcel:pickedUp': (p) => this.onPickedUp(p.id, p.vehicleId),
        'parcel:delivered': (p) => this.onDelivered(p.id, p.paid, p.onTime),
        'parcel:flagged': () => this.onFlagged(),
        'parcel:tossed': (p) => this.onTossed(p.wasMalware, p.bounty),
        'building:rushed': (p) => this.onRushed(p.buildingId, p.vehicleId),
        'building:rushCleared': (p) => {
          this.buildings.get(p.buildingId)?.setRush(null)
          if (this.tipRush?.buildingId === p.buildingId) this.tipRush = null
        },
        'satisfaction:changed': (p) => this.applyMood(p.district, p.value),
        'dock:queueLength': (p) => {
          this.queueN = p.n
        },
        'lane:stalled': () => {
          this.stalled = true
        },
        'lane:resumed': () => {
          this.stalled = false
        },
        'vehicle:bought': (p) => this.popOnCreate.add(p.id),
        // M8 (design-m8-m9 §6.2): docks 2–3, the overseas hand-off and clearance.
        'dock:bought': (p) => this.onDockBought(p.index),
        'parcel:handedOff': (p) => this.onHandedOff(p),
        'parcel:cleared': (p) => this.onCleared(p),
        'hub:departure': (p) => {
          this.departVessel(p.hub)
        },
        'vehicle:sold': (p) => this.onSold(p.id),
        // Build 3 M12 (B3 §3.5): an event took it — the sprite goes.
        'vehicle:lost': (p) => this.onLost(p.id),
        'day:ended': () => {
          this.refreshSign()
          this.refreshScorch()
        },
        // §1.4: 1 s crossfade (sprites + a second ground bake), then sign_pop.
        'region:unlocked': () => {
          this.applyLockState(true)
          this.refreshAttractStops()
        },
        // §9.6: fx_dust construction → wh_ext_t<tier> + the LEVEL stamp.
        'level:up': (p) => this.onLevelUp(p.level),
        'life:lost': (p) => {
          if (p.cause === 'event') return // event lives have no building to flash
          this.onLifeLost(p)
        },
        // M7 §6.8: the magic markers follow the active quest. Read on the
        // next frame — the facade's quests() cache keys on sim.revision,
        // which moves only after the emitting tick / command.
        'quest:accepted': () => {
          this.magicDirty = true
        },
        'quest:completed': () => {
          this.magicDirty = true
        },
        'quest:failed': () => {
          this.magicDirty = true
        },
      },
      () => this.syncAll(),
    )

    this.events.on(Phaser.Scenes.Events.WAKE, this.onWake, this)
    this.events.on(Phaser.Scenes.Events.SLEEP, this.onSleep, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this)
    this.syncAll()
    if (this.attract) this.beginAttract()
    else this.game.events.emit(EV_VIEW, { name: 'city' })
  }

  // ---------------------------------------------------------------- attract (B2 §5)

  /** Attract mode: input off, the camera tour from the lot. */
  private beginAttract(): void {
    this.input.enabled = false
    this.tooltip.hide()
    this.attractCam = new AttractCamera(this.cameras.main)
    this.attractCam.setStops(this.attractStopList())
    this.attractCam.begin(this.time.now)
  }

  /** The tour: the warehouse, then every live region's label tile. */
  private attractStopList(): { x: number; y: number }[] {
    return attractStops(
      this.warehouseCentre(),
      this.gd.map.regions,
      (id) => this.districts.has(id) && this.vs.regionState(id) === 'live',
      this.ox,
    )
  }

  private refreshAttractStops(): void {
    if (this.attract) this.attractCam?.setStops(this.attractStopList())
  }

  /**
   * Continue / New game over the attract city (B2 §5): the camera fades out
   * (ATTRACT_FADE_MS), then `swap` runs (the Title installs the
   * player's sim and wakes the HUD) and the scene becomes the game's City
   * under the fade-in. False when not in attract mode (or already leaving).
   */
  endAttract(swap: () => void): boolean {
    if (!this.attract || this.leavingAttract) return false
    this.leavingAttract = true
    // A recycle fading out right now: its fade carries this swap instead
    // (its own handler then does nothing; FADE_OUT_COMPLETE reaches both).
    const recycling = this.recyclingAttract
    this.recyclingAttract = false
    const cam = this.cameras.main
    const evt = Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE
    let done = false
    const go = (): void => {
      if (done) return
      done = true
      cam.off(evt, go)
      this.finishAttract(swap)
    }
    cam.once(evt, go)
    this.time.delayedCall(ATTRACT_SWAP_TIMEOUT_MS, go)
    const fade = cam.fadeEffect
    if (!(recycling && fade.isRunning && fade.direction))
      cam.fadeOut(ATTRACT_FADE_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2])
    return true
  }

  /**
   * Under the fade: drop every view of the demo city (vehicles, fx, scorch,
   * popups), let `swap` install the player's sim, rebuild from it (syncAll:
   * lock state + ground re-bake, tier, sign, moods), then the game camera on
   * the warehouse at zoom 1, input on, fade in, pm:view + pm:attractEnd.
   */
  private finishAttract(swap: () => void): void {
    this.attract = false
    this.leavingAttract = false
    this.recyclingAttract = false
    this.attractCam?.stop()
    this.attractCam = null
    this.dropDemoViews()
    try {
      swap()
    } catch (err) {
      console.error('city: the attract swap failed', err)
    }
    this.syncAll()
    const cam = this.cameras.main
    this.rig.stop()
    if (cam.zoom !== 1) cam.setZoom(1)
    const wc = this.warehouseCentre()
    this.focusOn(wc.x, wc.y, 0)
    this.input.enabled = true
    cam.resetFX()
    cam.fadeIn(ATTRACT_FADE_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2])
    this.game.events.emit(EV_VIEW, { name: 'city' })
    this.game.events.emit(EV_ATTRACT_END)
  }

  /** Every view of the demo city's moment: vehicles, fx, scorch, popups. */
  private dropDemoViews(): void {
    for (const v of this.vehicles.values()) v.destroy()
    this.vehicles.clear()
    for (const f of this.fx) f.img.destroy()
    this.fx = []
    for (const [id] of this.scorched) this.buildings.get(id)?.setScorch(false)
    this.scorched.clear()
    this.popOnCreate.clear()
    this.dirty.clear()
    this.popups.clear()
    this.tooltip.hide()
    if (this.followId !== null) this.unfollow(false)
  }

  /**
   * The Title's demo recycle (B2 §5; AttractCamera attractRecycleDue): under
   * the attract fade, `swap` re-installs the snapshot sim, the views are
   * rebuilt from it (syncAll) and the tour goes on. False when not in
   * attract mode, leaving it, or already recycling. A Continue / New game
   * that lands inside the fade wins: the recycle then does nothing.
   */
  recycleAttract(swap: () => void): boolean {
    if (!this.attract || this.leavingAttract || this.recyclingAttract)
      return false
    this.recyclingAttract = true
    const cam = this.cameras.main
    const evt = Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE
    let done = false
    const go = (): void => {
      if (done) return
      done = true
      cam.off(evt, go)
      if (!this.recyclingAttract) return
      this.recyclingAttract = false
      if (!this.attract || this.leavingAttract || this.shuttingDown) return
      this.dropDemoViews()
      try {
        swap()
      } catch (err) {
        console.error('city: the attract recycle failed', err)
      }
      this.syncAll()
      cam.resetFX()
      cam.fadeIn(ATTRACT_FADE_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2])
    }
    cam.once(evt, go)
    this.time.delayedCall(ATTRACT_SWAP_TIMEOUT_MS, go)
    cam.fadeOut(ATTRACT_FADE_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2])
    return true
  }

  // ---------------------------------------------------------------- debug

  /**
   * Debug (__pm.debugLotCorners): mark the four corners of the lot's
   * footprint diamond (map.json lot.warehouse, iso tileToScreen) with small
   * magenta crosses over everything, so the city-lot-zoom2 shot can check
   * the slab against the grid. Returns the new state.
   */
  setLotCorners(on: boolean): boolean {
    this.lotCorners?.destroy()
    this.lotCorners = null
    if (!on || !this.world) return false
    const wh = this.gd.map.lot.warehouse
    const [tx, ty] = wh.tile
    const x1 = tx + wh.footprint[0] - 1
    const y1 = ty + wh.footprint[1] - 1
    const n = tileToScreen(tx, ty, this.ox)
    const e = tileToScreen(x1, ty, this.ox)
    const s = tileToScreen(x1, y1, this.ox)
    const w = tileToScreen(tx, y1, this.ox)
    const corners: [number, number][] = [
      [n.x, n.y - HH],
      [e.x + HW, e.y],
      [s.x, s.y + HH],
      [w.x - HW, w.y],
    ]
    const g = this.add.graphics().setDepth(DEPTH.popup + 2)
    g.fillStyle(LOT_CORNER_COLOUR, 1)
    const a = LOT_CORNER_ARM
    for (const [cx, cy] of corners) {
      // (x, y) is a pixel corner: 2-px arms centred on it, the 2×2 pixels
      // around the vertex left clear so the slab's own corner shows.
      const x = Math.round(cx)
      const y = Math.round(cy)
      g.fillRect(x - 1 - a, y - 1, a, 2)
      g.fillRect(x + 1, y - 1, a, 2)
      g.fillRect(x - 1, y - 1 - a, 2, a)
      g.fillRect(x - 1, y + 1, 2, a)
    }
    this.world.add(g)
    this.lotCorners = g
    return true
  }

  // ---------------------------------------------------------------- lifecycle

  private onWake(): void {
    const cam = this.cameras.main
    const stored = this.registry.get(REG_CITY_CAM) as StoredCam | undefined
    cam.resetFX()
    if (stored) {
      this.registry.remove(REG_CITY_CAM)
      cam.setZoom(stored.zoom >= 2 ? 2 : 1)
      cam.setScroll(stored.scrollX, stored.scrollY)
      this.rig.settle()
    }
    cam.fadeIn(FADE_IN_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2])
    this.transitioning = false
    this.game.events.emit(EV_VIEW, { name: 'city' })
  }

  private onSleep(): void {
    this.transitioning = false
    this.tooltip.hide()
    this.popups.clear()
    this.hover = null
    // Asleep nothing animates: land every fade / the construction now, so
    // the wake shows the new state at once (§9.6 "tier 2 at once").
    this.finishFades()
    this.finishConstruction()
    this.clearLevelStamp()
  }

  private onShutdown(): void {
    this.shuttingDown = true
    this.attractCam?.stop()
    this.attractCam = null
    this.events.off(Phaser.Scenes.Events.WAKE, this.onWake, this)
    this.events.off(Phaser.Scenes.Events.SLEEP, this.onSleep, this)
    this.removeGameEvents()
    for (const v of this.vehicles.values()) v.destroy()
    for (const b of this.buildings.values()) b.destroy()
    for (const l of this.labels.values()) l.destroy()
    for (const h of this.hubViews.values()) h.destroy()
    this.vehicles.clear()
    this.buildings.clear()
    this.labels.clear()
    this.hubViews.clear()
    this.popups.destroy()
    this.tooltip.destroy()
    this.finishFades()
    this.finishConstruction()
    this.clearLevelStamp()
    // The DynamicTexture outlives the scene (TextureManager): a restarted
    // City (New game) bakes 'ground' again, so an unlock's 'ground_b' would
    // stay behind as a 3072×1536 orphan.
    this.ground?.destroy()
    this.ground = null
    this.occluders = []
  }

  /** nav.ts: the §5.3 city → warehouse exit (pan, zoom-2 snap, fade). */
  transitionOut(to: WorldView, done: () => void): void {
    const cam = this.cameras.main
    this.transitioning = true
    this.tooltip.hide()
    if (this.followId !== null) this.unfollow(true)
    this.rig.stop()
    const fade = (): void => {
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, done)
      cam.fadeOut(FADE_OUT_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2])
    }
    if (to !== 'warehouse') {
      fade()
      return
    }
    const stored: StoredCam = {
      zoom: cam.zoom,
      scrollX: cam.scrollX,
      scrollY: cam.scrollY,
    }
    this.registry.set(REG_CITY_CAM, stored)
    const c = this.warehouseCentre()
    this.rig.panTo(c.x, c.y, PAN_TO_WAREHOUSE_MS, () => {
      if (this.rig.zoom === 1)
        this.rig.zoomAt(2, cam.width * cam.originX, cam.height * cam.originY)
      fade()
    })
  }

  // ---------------------------------------------------------------- statics

  private isLockedNow(districtId: string): boolean {
    return (
      this.districts.has(districtId) &&
      this.vs.regionState(districtId) === 'locked'
    )
  }

  private isLocked(region: string): boolean {
    return this.lockState.get(region) === true
  }

  private buildStatics(): void {
    const map = this.gd.map
    const at = { x: 0, y: 0 }

    for (const def of this.gd.buildings) {
      const view = new BuildingView(
        this,
        this.world,
        this.ox,
        def,
        map.buildings[def.id]?.doorOffset,
        this.isLocked(def.district),
      )
      this.buildings.set(def.id, view)
      const list = this.byDistrict.get(def.district) ?? []
      list.push(view)
      this.byDistrict.set(def.district, list)
    }

    // Warehouse exterior (tier frame) + the dock-bay lights.
    const wh = map.lot.warehouse
    footprintAnchor(wh.tile, wh.footprint, this.ox, at)
    this.warehouseAnchor = { x: at.x, y: at.y }
    this.refreshWarehouse()
    BAY_LIGHTS.forEach((_, i) => {
      const img = this.add
        .image(0, 0, WORLD_ATLAS, 'wh_dock_light_green')
        .setOrigin(0.5, 1)
        .setDepth(footprintDepth(wh.tile, wh.footprint) + DEPTH.bell)
        .setVisible(false)
      img.setData('dock', i)
      this.world.add(img)
      this.dockLights.push(img)
    })
    this.placeDockLights()
    this.dockPose = this.makeDockPose()

    // Props (static Images; `_locked` frame while their region is fogged).
    for (const pr of map.props) {
      tileToScreen(pr.tile[0], pr.tile[1], this.ox, at)
      const pv: PropView = {
        frame: PROP_ALIAS[pr.frame] ?? pr.frame,
        region: pr.region,
        tile: [pr.tile[0], pr.tile[1]],
        img: null,
        x: Math.round(at.x),
        y: Math.round(at.y + HH),
        depth: pr.tile[0] + pr.tile[1] + 0.01,
      }
      this.props.push(pv)
      this.placeProp(pv)
    }
    this.buildHubs()

    // Days-since-last-incident sign on its lot tile with the counter.
    tileToScreen(map.lot.sign[0], map.lot.sign[1], this.ox, at)
    if (frameOrNull('sign_days')) {
      this.sign = this.add
        .image(
          Math.round(at.x),
          Math.round(at.y + HH),
          WORLD_ATLAS,
          'sign_days',
        )
        .setOrigin(0.5, 1)
        .setDepth(map.lot.sign[0] + map.lot.sign[1] + 0.01)
      this.world.add(this.sign)
      if (this.hasFont) {
        this.signText = this.add
          .bitmapText(0, 0, FONT_KEY, '', FONT_SIZE)
          .setTint(THEME.textDark)
          .setDepth(this.sign.depth + 0.001)
        this.world.add(this.signText)
      }
    }

    // District labels (+ lock signs) per region; the HQ lot has none.
    for (const r of map.regions) {
      const d = this.districts.get(r.id)
      if (!d) continue
      const label = new DistrictLabel(
        this,
        this.world,
        this.ox,
        {
          id: d.id,
          name: d.flavour,
          labelTile: r.labelTile,
          unlockLevel: d.unlockLevel,
          trucksOnly: d.allowed.length === 1 && d.allowed[0] === 'truck',
        },
        this.isLocked(d.id),
      )
      this.labels.set(d.id, label)
    }
    this.buildSmoke()
    this.refreshOccluders()
  }

  /**
   * The multi-tile footprints (buildings ≥ 2×2 and the warehouse) with their
   * sprites' opaque rects, for sortDepth (create, lock swaps, tier swaps).
   */
  private refreshOccluders(): void {
    const out: Occluder[] = []
    const add = (
      tile: readonly [number, number],
      fp: readonly [number, number],
      img: Phaser.GameObjects.Image | null,
    ): void => {
      if (!img || fp[0] < 2 || fp[1] < 2) return
      const r = visibleRect(img)
      out.push({
        x0: tile[0],
        y0: tile[1],
        x1: tile[0] + fp[0] - 1,
        y1: tile[1] + fp[1] - 1,
        depth: footprintDepth(tile, fp),
        left: r.x,
        top: r.y,
        right: r.right,
        bottom: r.bottom,
      })
    }
    for (const v of this.buildings.values())
      add(v.def.tile, v.def.footprint, v.image)
    const wh = this.gd.map.lot.warehouse
    add(wh.tile, wh.footprint, this.warehouse)
    this.occluders = out
  }

  private readonly sortVehicle = (
    tx: number,
    ty: number,
    base: number,
    rect: SpriteRect,
  ): number => sortDepth(tx, ty, base, rect, this.occluders)

  /**
   * (Re)create a prop's Image for its region's lock state. With `crossfade`
   * the new Image starts at alpha 0 and the old one is returned (the caller
   * fades and destroys it); otherwise the old one is destroyed.
   */
  private placeProp(
    pv: PropView,
    crossfade = false,
  ): Phaser.GameObjects.Image | null {
    const old = pv.img
    pv.img = null
    const locked = this.isLocked(pv.region)
    const name = lockedFrame(pv.frame, locked)
    if (name) {
      const img = this.add
        .image(pv.x, pv.y, WORLD_ATLAS, name)
        .setOrigin(0.5, 1)
        .setDepth(pv.depth)
      if (locked && !name.endsWith('_locked'))
        img.setTint(LOCKED_FILL).setTintMode(Phaser.TintModes.FILL)
      this.world.add(img)
      pv.img = img
    }
    if (crossfade && old && pv.img) {
      pv.img.setAlpha(0)
      return old
    }
    old?.destroy()
    return null
  }

  /**
   * Smoke puffs over the live Industrial chimneys (manifest smokeAnchors,
   * frames.generated SMOKE_ANCHORS): 3 puffs per emitter rising through
   * fx_smoke_f0..3 at 4 fps, each emitter phase-offset (cityFx.smokePuff).
   * None while the region is fogged or under quality cut 3.
   */
  private buildSmoke(): void {
    for (const s of this.smoke) for (const p of s.puffs) p.destroy()
    this.smoke = []
    if (this.shuttingDown || !this.quality.smoke || !frameOrNull('fx_smoke_f0'))
      return
    let emitter = 0
    for (const view of this.buildings.values()) {
      if (view.locked) continue
      const anchors = SMOKE_ANCHORS[buildingSprite(view.id)]
      if (!anchors || !view.image) continue
      // Anchors are canvas pixels; Image width/height = the source canvas.
      const cw = view.image.width
      const ch = view.image.height
      for (const [ax, ay] of anchors) {
        const x = Math.round(view.anchor.x - cw / 2 + ax)
        const y = Math.round(view.anchor.y - ch + ay)
        const puffs: Phaser.GameObjects.Image[] = []
        for (let k = 0; k < SMOKE_PUFFS; k++) {
          const img = this.add
            .image(x, y, WORLD_ATLAS, 'fx_smoke_f0')
            .setOrigin(0.5, 1)
            .setDepth(view.depth + DEPTH.smoke)
          this.world.add(img)
          puffs.push(img)
        }
        this.smoke.push({
          building: view.id,
          puffs,
          x,
          y,
          phaseMs: emitter++ * SMOKE_PHASE_MS,
        })
      }
    }
    this.updateSmoke(this.time.now)
  }

  /**
   * Where docked vehicles are drawn: the current exterior frame's per-bay
   * dockPoses (frames.generated WH_ANCHORS; cityFx.dockPoseCanvas) on the
   * exterior canvas, each relative to its map dock tile (lot.docks[k],
   * vehicles.ts dockTile by dock NUMBER), over the wall (art-install
   * hand-off: the dock tiles sit on the sprite's hidden NW side). One object
   * shared with every VehicleView: placeDockPose moves it on a tier swap,
   * refreshDockRun extends its run to the highest dock owned (M8, design-m8-m9
   * §6.2).
   */
  private makeDockPose(): DockPose | null {
    const map = this.gd.map
    if (map.lot.docks.length === 0) return null
    const lotBlock = map.blocks.find((b) => b.kind === 'lot')
    const rect = lotBlock
      ? blockRect(map, lotBlock.block[0], lotBlock.block[1])
      : null
    const wh = map.lot.warehouse
    const pose: DockPose = {
      tiles: [],
      lotX0: rect ? rect[0] : map.lot.entrance[0] + 1,
      poses: [],
      radius: 0,
      depth: footprintDepth(wh.tile, wh.footprint) + DOCK_POSE_DEPTH,
    }
    this.refreshDockRun(pose)
    this.placeDockPose(pose)
    return pose
  }

  /** Every bay's offset from the current exterior frame's anchors. */
  private placeDockPose(pose: DockPose | null = this.dockPose): void {
    if (!pose) return
    const name = this.warehouse?.frame.name ?? WH_ANCHOR_FRAME
    const anchors = warehouseAnchors(name)
    const left = this.warehouseAnchor.x - WH_CANVAS / 2
    const top = this.warehouseAnchor.y - WH_CANVAS
    pose.poses = this.gd.map.lot.docks.map((tile, i) => {
      const [px, py] = dockPoseCanvas(anchors, i + 1)
      const t = tileToScreen(tile[0], tile[1], this.ox)
      return { dx: left + px - t.x, dy: top + py - t.y }
    })
  }

  /**
   * The dock run: bays 1..n (n = the highest dock owned) and its blend
   * radius (never reaching the queue head). Create, dock:bought, sync.
   */
  private refreshDockRun(pose: DockPose | null = this.dockPose): void {
    if (!pose) return
    const lot = this.gd.map.lot
    const n = maxDockNumber(this.vs.docks.map((d) => d.id))
    pose.tiles = lot.docks.slice(0, Math.max(1, n))
    pose.radius = dockRunRadius(pose.tiles, lot.queue[0])
  }

  /**
   * M8 (design-m8-m9 §6.2): one CityHubView per map.hubs row — the clearance
   * ring on its office building, its vessel = the map.props row of the
   * hub's region at the vessel's tile.
   */
  private buildHubs(): void {
    for (const h of this.gd.map.hubs) {
      const frame = PROP_ALIAS[h.vessel.frame] ?? h.vessel.frame
      const vessel =
        this.props.find(
          (pv) =>
            pv.region === h.district &&
            pv.frame === frame &&
            pv.tile[0] === h.vessel.tile[0] &&
            pv.tile[1] === h.vessel.tile[1],
        ) ?? null
      const office = this.buildings.get(h.office) ?? null
      const depth = DEPTH.marker + (office?.depth ?? 0) + DEPTH.bell
      this.hubViews.set(
        h.district,
        new CityHubView(this, this.world, this.vs, h, {
          vessel,
          office,
          depth,
        }),
      )
    }
  }

  private warehouseCentre(): { x: number; y: number } {
    const img = this.warehouse
    if (!img)
      return { x: this.warehouseAnchor.x, y: this.warehouseAnchor.y - 64 }
    const r = visibleRect(img)
    return { x: Math.round(r.centerX), y: Math.round(r.centerY) }
  }

  /** The exterior tier of the sim's level (levels.json warehouseTier). */
  private simTier(): number {
    const level = this.vs.level
    return this.gd.levels.find((l) => l.level === level)?.warehouseTier ?? 1
  }

  /** Snap the exterior to the sim's tier (create, wake, sim swap). */
  private refreshWarehouse(): void {
    this.finishConstruction()
    this.setWarehouseTier(this.simTier())
  }

  private setWarehouseTier(tier: number): void {
    if (tier === this.warehouseTier && this.warehouse) return
    const name = frameOrNull(`wh_ext_t${tier}`) ?? frameOrNull('wh_ext_t1')
    if (!name) return
    this.warehouseTier = tier
    const wh = this.gd.map.lot.warehouse
    if (!this.warehouse) {
      this.warehouse = this.add
        .image(
          this.warehouseAnchor.x,
          this.warehouseAnchor.y,
          WORLD_ATLAS,
          name,
        )
        .setOrigin(0.5, 1)
        .setDepth(footprintDepth(wh.tile, wh.footprint))
      this.world.add(this.warehouse)
    } else this.warehouse.setFrame(name)
    this.placeDockLights()
    this.placeDockPose()
    this.refreshOccluders()
  }

  /**
   * The dock-bay lights on the current exterior frame's lamps (manifest
   * bayLights, per frame through frames.generated WH_ANCHORS: an edited tier
   * keeps the footprint but its lamps can move a few px).
   */
  private placeDockLights(): void {
    const name = this.warehouse?.frame.name ?? WH_ANCHOR_FRAME
    const { bayLights } = warehouseAnchors(name)
    const left = this.warehouseAnchor.x - WH_CANVAS / 2
    const top = this.warehouseAnchor.y - WH_CANVAS
    this.bayLightCount = bayLights.length
    this.dockLights.forEach((img, i) => {
      const p = bayLights[i]
      if (p) img.setPosition(left + p[0], top + p[1])
      else img.setVisible(false)
    })
  }

  /**
   * The days-since-last-incident counter, on the cracked board while it reads
   * 0 after a lost life (cracks on life:lost, replaced at 1 again, Q33).
   */
  private refreshSign(): void {
    const sign = this.sign
    const t = this.signText
    if (!sign) return
    const n = this.vs.daysSinceIncident
    const cracked = signCracked(n, getSim(this)?.state.lastLostLife != null)
    const frame =
      (cracked ? frameOrNull('sign_days_cracked') : null) ?? 'sign_days'
    if (sign.frame.name !== frame) sign.setFrame(frame)
    if (!t) return
    t.setText(signDaysText(n))
    const left = sign.x - sign.width / 2
    const top = sign.y - sign.height
    const f = SIGN_FACE
    t.setPosition(
      Math.round(left + f.x + (f.w - t.width) / 2),
      capTop(top + f.y + f.h / 2),
    )
  }

  /**
   * Apply region lock changes. Snap on create / wake / sim swap; on
   * region:unlocked (`animate`) the city-view §1.4 sequence: the colour
   * frames fade in over 1 s while the `_locked` ones fade out, a second
   * ground bake fades in over the old one (then the old bake is destroyed),
   * and once the fade is done the lock sign pops (sign_pop, 300 ms) and the
   * smoke emitters start. Mood overlays start hidden (satisfaction 60).
   */
  private applyLockState(animate = false): void {
    const ins: Phaser.GameObjects.Image[] = []
    const outs: Phaser.GameObjects.Image[] = []
    const opened: string[] = []
    const now = this.time.now
    const changes = this.gd.districts.filter(
      (d) => this.lockState.get(d.id) !== this.isLockedNow(d.id),
    )
    if (changes.length === 0) return
    // A previous unlock still fading lands first (one ground fade at a time).
    if (this.groundFading) this.finishFades()
    for (const d of changes) {
      const locked = this.isLockedNow(d.id)
      this.lockState.set(d.id, locked)
      // Only an unlock animates; a re-lock (sim swap) always snaps.
      const fade = animate && !locked
      for (const v of this.byDistrict.get(d.id) ?? []) {
        const { from, to } = v.setLocked(locked, fade)
        if (from && to) {
          outs.push(from)
          ins.push(to)
        }
      }
      for (const pv of this.props) {
        if (pv.region !== d.id) continue
        const old = this.placeProp(pv, fade)
        if (old && pv.img) {
          outs.push(old)
          ins.push(pv.img)
        }
      }
      const label = this.labels.get(d.id)
      if (fade) label?.beginUnlock(now + UNLOCK_FADE_MS)
      else label?.setLocked(locked)
      if (!locked) opened.push(d.id)
    }
    for (const id of opened) {
      const st = this.vs.districtStats(id)
      if (st && st.kind === 'district') this.applyMood(id, st.satisfaction)
    }
    this.refreshOccluders()
    const isLocked = (id: string): boolean => this.lockState.get(id) === true
    const old = this.ground
    if (!animate || !old || ins.length + outs.length === 0) {
      this.ground?.rebake(isLocked)
      this.buildSmoke()
      return
    }
    const next = bakeGround(this, this.gd.map, {
      isLocked,
      key: nextGroundKey(old.texture.key),
      depth: GROUND_FADE_DEPTH,
    })
    next.image.setAlpha(0)
    this.world.add(next.image)
    ins.push(next.image)
    this.ground = next
    this.groundFading = true
    this.addFade({
      ins,
      outs,
      start: now,
      ms: UNLOCK_FADE_MS,
      done: () => {
        old.destroy()
        next.image.setDepth(-1)
        this.groundFading = false
        this.buildSmoke()
      },
    })
  }

  // ---------------------------------------------------------------- fades

  private addFade(f: Fade): void {
    this.fades.push(f)
    this.stepFade(f, this.time.now)
  }

  /** Step one fade; true once it is over (outs destroyed, done run). */
  private stepFade(f: Fade, now: number): boolean {
    const k = fadeK(now - f.start, f.ms)
    for (const o of f.ins) if (o.scene) o.setAlpha(k)
    for (const o of f.outs) if (o.scene) o.setAlpha(1 - k)
    if (k < 1) return false
    for (const o of f.outs) o.destroy()
    f.done?.()
    return true
  }

  private updateFades(now: number): void {
    if (this.fades.length === 0) return
    this.fades = this.fades.filter((f) => !this.stepFade(f, now))
  }

  /** Land every fade now (sleep, sync, shutdown, a second unlock). */
  private finishFades(): void {
    const all = this.fades
    this.fades = []
    for (const f of all) this.stepFade(f, Infinity)
    for (const l of this.labels.values()) if (l.popping) l.setLocked(l.locked)
  }

  // ---------------------------------------------------------------- level-up (§9.6)

  /**
   * level:up: fx_dust covers the exterior (4 frames × 250 ms: scaffold,
   * dust, dust, reveal), the sprite swaps to wh_ext_t<tier> as the reveal
   * frame starts, and the gold "LEVEL 2 — LOCAL" stamp rises 24 px over
   * 1.2 s from the roof (a dedicated object, not the popup pool). The sting
   * is the AudioDirector's level:up hook. No auto-pan.
   */
  private onLevelUp(level: number): void {
    const row = this.gd.levels.find((l) => l.level === level)
    this.finishConstruction()
    this.startConstruction(row?.warehouseTier ?? this.simTier())
    this.showLevelStamp(levelStampText(level, row?.title ?? ''))
  }

  private startConstruction(tier: number): void {
    const img = this.warehouse
    if (!img || !frameOrNull('fx_dust_f0')) {
      this.setWarehouseTier(tier)
      return
    }
    // report §6.23: ONE cloud over the whole exterior, placed like wh_ext
    // (origin (0.5, 1) on the footprint anchor), not a grid of puffs.
    const a = this.warehouseAnchor
    const d = this.add
      .image(a.x, a.y, WORLD_ATLAS, 'fx_dust_f0')
      .setOrigin(0.5, 1)
      .setDepth(img.depth + DUST_DEPTH)
    this.world.add(d)
    const dust = [d]
    this.construction = { start: this.time.now, tier, dust, swapped: false }
  }

  private updateConstruction(now: number): void {
    const c = this.construction
    if (!c) return
    const elapsed = now - c.start
    if (!c.swapped && elapsed >= CONSTRUCTION_SWAP_MS) {
      c.swapped = true
      this.setWarehouseTier(c.tier)
    }
    const f = dustFrame(elapsed)
    if (f === null) {
      this.finishConstruction()
      return
    }
    const name = `fx_dust_f${f}`
    for (const d of c.dust)
      if (d.frame.name !== name) d.setFrame(name, false, false)
  }

  /** End the construction now (its tier applied). */
  private finishConstruction(): void {
    const c = this.construction
    if (!c) return
    this.construction = null
    for (const d of c.dust) d.destroy()
    if (!c.swapped) this.setWarehouseTier(c.tier)
  }

  private showLevelStamp(label: string): void {
    this.clearLevelStamp()
    if (!this.hasFont) return
    const text = this.add
      .bitmapText(0, 0, FONT_KEY, label, FONT_SIZE_BIG)
      .setTint(THEME.gold)
      .setDropShadow(STAMP_SHADOW, STAMP_SHADOW, THEME.shadow, 1)
    const w = Math.round(text.width) + STAMP_PILL_PAD * 2
    const pill = this.add
      .nineslice(
        0,
        0,
        WORLD_ATLAS,
        'ui_panel_dark',
        w,
        STAMP_PILL_H,
        4,
        4,
        4,
        4,
      )
      .setOrigin(0.5, 0.5)
      .setAlpha(0.85)
    // m5x7 at 32 px: cap top 8, cap height 14 (2× the 16-px metrics).
    text.setPosition(-Math.round(text.width / 2), -8 - 7)
    const img = this.warehouse
    const y = img
      ? Math.round(visibleRect(img).y + STAMP_FROM_TOP)
      : this.warehouseAnchor.y - 160
    const box = this.add
      .container(this.warehouseAnchor.x, y, [pill, text])
      .setDepth(STAMP_DEPTH)
    this.world.add(box)
    this.levelStamp = { start: this.time.now, box, y }
  }

  private updateLevelStamp(now: number): void {
    const st = this.levelStamp
    if (!st) return
    const pose = stampPose(now - st.start)
    if (!pose) {
      this.clearLevelStamp()
      return
    }
    st.box.setPosition(st.box.x, st.y + pose.dy).setAlpha(pose.alpha)
  }

  private clearLevelStamp(): void {
    this.levelStamp?.box.destroy()
    this.levelStamp = null
  }

  // ---------------------------------------------------------------- sync

  /** Rebuild everything from sim state (create, WAKE, sim swap). */
  private syncAll(): void {
    if (!this.world) return
    this.finishFades()
    this.clearLevelStamp()
    this.applyLockState()
    this.refreshWarehouse()
    this.refreshSign()
    this.syncScorch()
    this.popups?.clear()
    this.tooltip?.hide()
    this.tipRush = null
    // Vehicles: drop views whose vehicle is gone; update() creates the rest.
    const ids = new Set(this.vs.vehicles.map((v) => v.id))
    for (const [id, view] of this.vehicles)
      if (!ids.has(id)) {
        view.destroy()
        this.vehicles.delete(id)
      }
    if (this.followId !== null && !ids.has(this.followId)) this.unfollow(true)
    this.queueN = this.vs.dockQueue.length
    this.stalled = this.vs.lane.stalled !== null
    this.refreshDockRun()
    this.stampSums.clear()
    for (const h of this.hubViews.values()) h.syncAll()
    this.syncMoods()
    this.refreshMarkers()
    this.refreshMagic()
    this.refreshAttractStops()
  }

  /** Waiting badges and rush bells of every live building (2 Hz + on sync). */
  private refreshMarkers(): void {
    for (const view of this.buildings.values()) this.refreshBuilding(view)
    this.dirty.clear()
  }

  /**
   * M7 (B2 §3.3, design-m7 §6.8): `ic_magic` + its countdown ring on A and B
   * while the golden parcel is alive; the pair that no longer applies is
   * cleared.
   */
  private refreshMagic(): void {
    this.magicDirty = false
    const qs = this.vs.quests()
    const m = magicMarkers(qs.active, qs.magic)
    const ids = m ? [m.origin, m.dest] : []
    for (const id of this.magicIds)
      if (!ids.includes(id)) this.buildings.get(id)?.setMagic(null)
    if (m) for (const id of ids) this.buildings.get(id)?.setMagic(m.remaining01)
    this.magicIds = ids
  }

  private refreshBuilding(view: BuildingView): void {
    if (view.locked) return
    const waiting = this.vs.waitingAt(view.id)
    let oldest = Infinity
    for (const p of waiting) oldest = Math.min(oldest, p.spawnedTick)
    const ageS = waiting.length > 0 ? (this.vs.tick - oldest) / TICKS_PER_S : 0
    const rush = this.vs.rushState(view.id)
    // Quality cut 4 (R4): badges only on rushed buildings.
    const n = this.quality.badgesRushedOnly && !rush ? 0 : waiting.length
    view.setWaiting(n, decayPhase(ageS, this.gd.parcels))
    if (rush) {
      const total = this.gd.vehicles.rushExpireS * TICKS_PER_S
      const left = Math.max(0, rush.untilTick - this.vs.tick)
      view.setRush(Math.min(1, left / total))
    } else view.setRush(null)
  }

  /**
   * Spec §9.2: one overlay per building from the district value (flower
   * boxes ≥ happyAbove, shutters < loudBelow; none while fogged or under
   * quality cut 1) and the angry label icon below loudBelow.
   */
  private applyMood(districtId: string, value: number): void {
    const kind = moodFor(value, this.gd.economy.satisfaction)
    const locked = this.isLocked(districtId)
    const show = !locked && this.quality.moodOverlays
    for (const v of this.byDistrict.get(districtId) ?? [])
      v.setMood(show ? kind : null)
    this.labels.get(districtId)?.setAngry(!locked && kind === 'unhappy')
  }

  /** Re-apply every live district's mood (sync, quality change). */
  private syncMoods(): void {
    for (const d of this.gd.districts) {
      if (d.kind !== 'district') continue // hubs have no satisfaction (§9.1)
      const st = this.vs.districtStats(d.id)
      if (st) this.applyMood(d.id, st.satisfaction)
    }
  }

  /** quality:changed (R4 cut order): re-apply every consumer. */
  private applyQuality(): void {
    this.quality = this.qualityCtl?.flags ?? qualityFlags(0)
    this.popups.setCapacity(this.quality.popupPool)
    this.buildSmoke()
    this.syncMoods()
    this.refreshMarkers()
  }

  /**
   * Spec §9.2 grumble: an angry district label on screen grumbles now, then
   * every 20 s (DistrictLabel.tickGrumble; the director throttles overall).
   * Quiet while the sim is paused (0×, a modal card, or a pending card
   * holding the sim — review sim-3), like the director's own loops.
   */
  private updateGrumble(now: number): void {
    const st = getStepper(this)
    if (st && simStopped(st)) return
    const view = this.cameras.main.worldView
    let due = false
    for (const l of this.labels.values())
      if (l.tickGrumble(now, l.angryOnScreen(view))) due = true
    if (due) this.emit(EV_UI_SFX, { name: 'grumble' })
  }

  // ---------------------------------------------------------------- update

  update(_time: number, delta: number): void {
    const now = this.time.now
    if (this.attractCam) this.attractCam.update(now)
    else {
      this.rig.update(delta)
      this.gestures.update()
      this.keyPan()
    }

    this.updateVehicles(now)
    this.popups.update(delta)
    this.tooltip.update(delta)
    this.updateFx(now)
    this.updateFades(now)
    this.updateConstruction(now)
    this.updateLevelStamp(now)
    for (const l of this.labels.values()) l.update(now)
    this.updateSmoke(now)
    this.updateDockLights(now)
    if (this.hubViews.size > 0) {
      const tickNow = this.vs.tick + getAlpha(this)
      for (const h of this.hubViews.values()) h.update(now, tickNow)
    }
    if (this.zone)
      this.zone.setAlpha(
        0.6 + 0.2 * Math.sin((2 * Math.PI * now) / ZONE_PULSE_MS),
      )

    for (const id of this.dirty) {
      const v = this.buildings.get(id)
      if (v) this.refreshBuilding(v)
    }
    this.dirty.clear()
    if (this.magicDirty) this.refreshMagic()
    this.refreshAcc += delta
    if (this.refreshAcc >= REFRESH_MS) {
      this.refreshAcc = 0
      this.refreshMarkers()
      this.refreshMagic()
      this.refreshTooltip()
      if (this.scorched.size > 0) this.refreshScorch()
      // The demo city never makes a sound (B2 §5).
      if (!this.attract) this.updateGrumble(now)
    }
    if (!this.attract) this.updateHover(now)
  }

  private updateVehicles(now: number): void {
    const alpha = getAlpha(this)
    const snaps = this.vs.vehicles
    const wv = this.cameras.main.worldView
    const staticWheels = this.quality.staticWheels
    let seen = 0
    for (const v of snaps) {
      let view = this.vehicles.get(v.id)
      if (!view) {
        view = new VehicleView(this, this.world, this.ox, v, this.dockPose)
        this.vehicles.set(v.id, view)
      }
      seen++
      const colour =
        v.zone === 'any' ? null : (this.regionColour.get(v.zone) ?? null)
      // On screen = last frame's position inside the view (honk bubble, §2).
      const onScreen = wv.contains(view.x, view.y)
      view.update(v, alpha, now, colour, {
        onScreen,
        staticWheels,
        sortDepth: this.sortVehicle,
      })
      if (this.popOnCreate.delete(v.id))
        this.playFx(view.x, view.y, 'fx_pop', FX_POP_MS, false, view.img.depth)
    }
    if (seen !== this.vehicles.size) {
      const ids = new Set(snaps.map((v) => v.id))
      for (const [id, view] of this.vehicles)
        if (!ids.has(id)) {
          view.destroy()
          this.vehicles.delete(id)
          if (this.followId === id) this.unfollow(true)
        }
    }
  }

  private updateDockLights(now: number): void {
    const owned = this.vs.docks.map((d) => d.id)
    const red = this.queueN > 0 || this.stalled
    const blinkOn = !this.stalled || Math.floor(now / LIGHT_BLINK_MS) % 2 === 0
    this.dockLights.forEach((img, i) => {
      // By dock NUMBER (M8): lamp k lights for dock k + 1 when it is owned;
      // a frame with fewer lamps (t3: two bays) hides the rest.
      if (!bayLightShown(i, owned, this.bayLightCount)) {
        img.setVisible(false)
        return
      }
      const f = red ? 'wh_dock_light_red' : 'wh_dock_light_green'
      if (img.frame.name !== f) img.setFrame(f, false, false)
      img.setVisible(blinkOn)
    })
  }

  private updateSmoke(now: number): void {
    for (const s of this.smoke)
      s.puffs.forEach((p, k) => {
        const puff = smokePuff(now, s.phaseMs, k)
        const f = `fx_smoke_f${puff.frame}`
        if (p.frame.name !== f) p.setFrame(f, false, false)
        p.setPosition(s.x + puff.dx, s.y + puff.dy)
      })
  }

  private playFx(
    x: number,
    y: number,
    stem: string,
    ms: number,
    reverse: boolean,
    depth: number,
    count = 4,
  ): void {
    const frames = Array.from({ length: count }, (_, i) => `${stem}_f${i}`)
    if (reverse) frames.reverse()
    if (!frames.every((f) => frameOrNull(f))) return
    const img = this.add
      .image(Math.round(x), Math.round(y), WORLD_ATLAS, frames[0])
      .setOrigin(0.5, 0.75)
      .setDepth(depth + DEPTH.smoke)
    this.world.add(img)
    this.fx.push({ img, frames, start: this.time.now, ms })
  }

  private updateFx(now: number): void {
    if (this.fx.length === 0) return
    this.fx = this.fx.filter((f) => {
      const i = Math.floor(((now - f.start) / f.ms) * f.frames.length)
      if (i >= f.frames.length) {
        f.img.destroy()
        return false
      }
      const name = f.frames[Math.max(0, i)]
      if (name && f.img.frame.name !== name) f.img.setFrame(name)
      return true
    })
  }

  // ---------------------------------------------------------------- sim events

  /** The parcel (alive during the emitting tick) for origin / destination. */
  private parcel(id: number) {
    return this.vs.parcel(id)
  }

  private onPickedUp(id: number, vehicleId: number): void {
    const p = this.parcel(id)
    if (!p) return
    this.dirty.add(p.origin)
    const b = this.buildings.get(p.origin)
    if (!b) return
    // M7 §6.8: the golden parcel hops as ic_magic.
    const icon = hopIcon(p)
    this.popups.pickup(
      this.viewRect,
      b.id,
      b.door.x,
      b.door.y - POPUP_LIFT,
      icon,
    )
    // B2 §6.3 (F4): the icon flies into the vehicle body and sinks there
    // (scale → 0 over the last 40 %) — it never rests on the roof.
    const v = this.vehicles.get(vehicleId)
    if (v) {
      const c = v.bodyCentre()
      this.popups.hop(this.viewRect, b.door.x, b.door.y, c.x, c.y, icon, {
        sink: true,
      })
    }
  }

  private onDelivered(id: number, paid: number, onTime: boolean): void {
    const p = this.parcel(id)
    if (!p) return
    this.dirty.add(p.dest)
    const b = this.buildings.get(p.dest)
    if (!b) return
    // The delivery hop leaves the vehicle body at full size (B2 §6.3).
    const v = p.vehicleId !== null ? this.vehicles.get(p.vehicleId) : undefined
    if (v) {
      const c = v.bodyCentre()
      this.popups.hop(this.viewRect, c.x, c.y, b.door.x, b.door.y, hopIcon(p))
    }
    this.popups.delivered(
      this.viewRect,
      b.id,
      b.door.x,
      b.door.y - POPUP_LIFT,
      paid,
      onTime,
    )
  }

  // ---------------------------------------------------------------- M8 hubs + docks

  /**
   * dock:bought (design-m8-m9 §6.2): the run reaches the new bay (its docked
   * pose), its lamp lights from the next frame (updateDockLights by number)
   * and pops once (fx_pop) when the exterior has that lamp.
   */
  private onDockBought(index: number): void {
    this.refreshDockRun()
    const img = this.dockLights[index - 1]
    if (!img || index - 1 >= this.bayLightCount) return
    this.playFx(img.x, img.y, 'fx_pop', FX_POP_MS, false, img.depth)
  }

  /** The VehicleView handing parcel `id` off at pier `b` (cityHub.handOffVehicleId). */
  private handOffVehicle(id: number, b: BuildingView): VehicleView | null {
    const vid = handOffVehicleId(this.vs.vehicles, id, b.id, b.def.anchor)
    return vid === null ? null : (this.vehicles.get(vid) ?? null)
  }

  /** Dollars of a same-key stamp inside the Popups merge window (cityHub.stampSum). */
  private stampDollars(key: string, value: number): number {
    const next = stampSum(
      this.stampSums.get(key),
      this.time.now,
      value,
      MERGE_MS,
    )
    this.stampSums.set(key, next)
    return next.sum
  }

  /**
   * parcel:handedOff (B2 §4.1): the delivery hop from the vehicle's body
   * into the pier, then the grey `LOCKED $18` stamp at the pier's door.
   */
  private onHandedOff(p: SimEventPayloads['parcel:handedOff']): void {
    const b = this.buildings.get(p.buildingId)
    if (!b) return
    const parcel = this.parcel(p.id)
    const v = this.handOffVehicle(p.id, b)
    if (v && parcel) {
      const c = v.bodyCentre()
      this.popups.hop(
        this.viewRect,
        c.x,
        c.y,
        b.door.x,
        b.door.y,
        hopIcon(parcel),
      )
    }
    const key = `lock:${b.id}`
    this.popups.stamp(
      this.viewRect,
      key,
      b.door.x,
      b.door.y - POPUP_LIFT,
      lockedStampText(this.stampDollars(key, p.lockedValue)),
      STAMP_GREY,
    )
  }

  /**
   * parcel:cleared (B2 §4.1, §5.6) at the hub's office: gold `CLEARED +$18`,
   * or red `SHIP HAS SAILED` (Airport `PLANE HAS LEFT`) for malware — the
   * lost life itself (boom, scorch on the pier, the HUD card) is life:lost's.
   * M9: the stamp rises from just above the office's ring (cityHub
   * clearStampPoint), off the Airport terminal's door, where its own
   * hand-offs stamp `LOCKED $40`.
   */
  private onCleared(p: SimEventPayloads['parcel:cleared']): void {
    const officeId = this.hubViews.get(p.hub)?.office ?? p.buildingId
    const b = this.buildings.get(officeId)
    if (!b) return
    const { x, y } = clearStampPoint(b)
    if (p.malware) {
      this.popups.stamp(
        this.viewRect,
        `sail:${b.id}`,
        x,
        y,
        lostStampText(p.hub),
        STAMP_RED,
      )
      return
    }
    const key = `clear:${b.id}`
    this.popups.stamp(
      this.viewRect,
      key,
      x,
      y,
      clearedStampText(this.stampDollars(key, p.paid)),
      STAMP_GOLD,
    )
  }

  /**
   * hub:departure → the hub's vessel leaves (ignored while it is away: one
   * trip per batch). Public for debug / e2e (the ship-departure shot); true
   * when a trip started.
   */
  departVessel(hub: string): boolean {
    return (
      this.hubViews.get(hub)?.depart(this.time.now, reducedMotion()) ?? false
    )
  }

  /** Debug / e2e probe: a hub's vessel phase and the ring frame shown (null hidden). */
  hubProbe(hub: string): { phase: string; ring: number | null } | null {
    const h = this.hubViews.get(hub)
    return h ? { phase: h.phase, ring: h.ringShown } : null
  }

  private warehouseRoof(): { x: number; y: number; depth: number } {
    const img = this.warehouse
    const r = img ? visibleRect(img) : null
    return {
      x: this.warehouseAnchor.x,
      y: r ? Math.round(r.y + 40) : this.warehouseAnchor.y - 100,
      depth: img?.depth ?? 48,
    }
  }

  /** parcel:flagged (any view): fx_ping ring at the warehouse roof (§3.2). */
  private onFlagged(): void {
    const roof = this.warehouseRoof()
    this.playFx(roof.x, roof.y, 'fx_ping', FX_PING_MS, false, DEPTH.marker)
  }

  /** parcel:tossed: DEFUSED +$50 gold (+ shake) / OOPS −$25 grey (§3.2). */
  private onTossed(wasMalware: boolean, bounty: number): void {
    const roof = this.warehouseRoof()
    if (wasMalware) {
      this.popups.stamp(
        this.viewRect,
        'warehouse',
        roof.x,
        roof.y,
        `DEFUSED +$${bounty}`,
        STAMP_GOLD,
      )
      this.shake(SHAKE_DEFUSED)
    } else {
      this.popups.stamp(
        this.viewRect,
        'warehouse',
        roof.x,
        roof.y,
        oopsStampText(this.wrongTossFee()),
        STAMP_GREY,
      )
    }
  }

  /**
   * Build 3 M12 (B3 §3.6): the fee this wrong Toss costs — the sim's own
   * formula on its state now (parcel:tossed fires before the debit); the
   * data's fee when no sim is bound.
   */
  private wrongTossFee(): number {
    const sim = getSim(this)
    return sim ? wrongTossFeeNow(sim) : this.gd.economy.wrongTossFee
  }

  /** Camera shake (city-view §3.2-§3.3), skipped under prefers-reduced-motion. */
  private shake([ms, intensity]: readonly [number, number]): void {
    if (reducedMotion() || !this.scene.isActive()) return
    this.cameras.main.shake(ms, intensity)
  }

  /**
   * life:lost (city-view §3.3, city side): camera shake, fx_boom over the
   * destination building and its one-day scorch, the sign cracks and its
   * counter resets. The red flash, the bomb fuse and the card are the HUD's.
   */
  private onLifeLost(p: LifeLostPayload): void {
    // Never behind the Title's logo (the demo is recycled on a loss anyway).
    if (!this.attract) this.shake(SHAKE_LOST_LIFE)
    const b = this.buildings.get(p.destBuildingId)
    if (b) {
      const r = b.image ? visibleRect(b.image) : null
      const x = r ? r.centerX : b.anchor.x
      const y = r ? r.centerY : b.anchor.y - 32
      this.playFx(
        x,
        y,
        'fx_boom',
        FX_BOOM_MS,
        false,
        DEPTH.marker + b.depth,
        FX_BOOM_FRAMES,
      )
      const tick = p.report?.tick ?? this.vs.tick
      this.scorched.set(b.id, tick + TICKS_PER_DAY)
      b.setScorch(true)
    }
    this.refreshSign()
  }

  /** Drop scorches whose in-game day is over (2 Hz, day:ended). */
  private refreshScorch(): void {
    const now = this.vs.tick
    for (const [id, until] of this.scorched) {
      // A swapped-in sim may run behind the stored tick: drop those too.
      if (now < until && until - now <= TICKS_PER_DAY) continue
      this.scorched.delete(id)
      this.buildings.get(id)?.setScorch(false)
    }
  }

  /** Rebuild the scorch from sim state (wake, sim swap): the last loss only. */
  private syncScorch(): void {
    const last = getSim(this)?.state.lastLostLife ?? null
    // An event's life (build 3) has no building to scorch.
    if (
      last &&
      last.kind !== 'event' &&
      !this.scorched.has(last.destBuildingId)
    )
      this.scorched.set(last.destBuildingId, last.tick + TICKS_PER_DAY)
    this.refreshScorch()
    for (const [id] of this.scorched) this.buildings.get(id)?.setScorch(true)
  }

  /**
   * The building tooltip's panel in screen px while it shows, else null:
   * the HUD keeps its onboarding card off it (M1 polish: the step-3 card
   * overlapped the tooltip).
   */
  tooltipScreenRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.tooltip?.visible || !this.sys.isActive()) return null
    const panel = (
      this.tooltip as unknown as { panel?: Phaser.GameObjects.NineSlice }
    ).panel
    if (!panel) return null
    const cam = this.cameras.main
    const v = cam.worldView
    const z = cam.zoom
    return {
      x: Math.round((panel.x - v.x) * z + cam.x),
      y: Math.round((panel.y - v.y) * z + cam.y),
      w: Math.round(panel.width * z),
      h: Math.round(panel.height * z),
    }
  }

  private onRushed(buildingId: string, vehicleId: number | null): void {
    const b = this.buildings.get(buildingId)
    if (b) this.refreshBuilding(b)
    if (vehicleId !== null)
      this.vehicles.get(vehicleId)?.ringBell(this.time.now)
  }

  private onSold(id: number): void {
    const view = this.vehicles.get(id)
    if (!view) return
    this.playFx(view.x, view.y, 'fx_pop', FX_POP_MS, true, view.img.depth)
    view.destroy()
    this.vehicles.delete(id)
    if (this.followId === id) this.unfollow(true)
  }

  /** Build 3 M12 (`vehicle:lost`): the view leaves under a puff; follow ends. */
  private onLost(id: number): void {
    const view = this.vehicles.get(id)
    if (!view) return
    this.playFx(view.x, view.y, 'fx_puff', FX_LOST_MS, false, view.img.depth)
    view.destroy()
    this.vehicles.delete(id)
    if (this.followId === id) this.unfollow(true)
  }

  // ---------------------------------------------------------------- camera

  private relayout(): void {
    const st = (this.registry.get(REG.safeTop) as number | undefined) ?? 0
    const sb = (this.registry.get(REG.safeBottom) as number | undefined) ?? 0
    this.L = computeLayout(
      this.scale.width,
      this.scale.height,
      st,
      sb,
      this.scale.zoom,
    )
  }

  /**
   * Centre world point (wx, wy) in the uncovered city area (between the HUD
   * bands; with `cover`, in the top part above a sheet covering that
   * fraction of the screen). ms = 0 jumps; onDone runs once it is there.
   */
  private focusOn(
    wx: number,
    wy: number,
    ms = 350,
    cover?: number,
    onDone?: () => void,
  ): void {
    const cam = this.cameras.main
    const H = this.scale.height
    const top = this.L.world.y
    const bottom =
      cover !== undefined && cover > 0
        ? Math.max(top + 32, Math.round(H * (1 - cover)))
        : this.L.world.y + this.L.world.h
    const fy = (top + bottom) / 2
    const cx = wx
    const cy = wy + (H / 2 - fy) / cam.zoom
    if (ms <= 0) {
      this.rig.centerOn(cx, cy)
      this.rig.settle()
      onDone?.()
    } else this.rig.panTo(cx, cy, ms, onDone)
  }

  /**
   * The uncovered city area in world coordinates (tooltip clamp): below the
   * HUD's toast lane (city-view §4.2), so a toast never covers a tooltip's
   * name row — the Docks at the map's west edge clamp their pier / office
   * tooltips to the top of the view (M8 review).
   */
  private clampRect(): ClampRect {
    const cam = this.cameras.main
    const v = cam.worldView
    const z = cam.zoom
    const L = this.L
    const top = Math.max(L.world.y, L.toast.y + L.toast.h)
    return {
      x: v.x,
      y: v.y + top / z,
      w: v.width,
      h: Math.max(0, L.world.y + L.world.h - top) / z,
    }
  }

  private follow(id: number, emit: boolean): void {
    const view = this.vehicles.get(id)
    if (!view) return
    this.tooltip.hide()
    this.followId = id
    this.rig.follow(view.img)
    if (emit) this.game.events.emit(EV_FOLLOW, { vehicleId: id })
  }

  private unfollow(emit: boolean): void {
    const was = this.followId
    this.followId = null
    this.rig.unfollow()
    if (emit && was !== null)
      this.game.events.emit(EV_FOLLOW, { vehicleId: null })
  }

  private setZone(districtId: string | null): void {
    this.zone?.destroy()
    this.zone = null
    this.zoneDistrict = districtId
    const d = districtId ? this.districts.get(districtId) : undefined
    if (!d) return
    const g = this.add.graphics().setDepth(DEPTH.highlight)
    const colour = this.regionColour.get(d.id) ?? THEME.warn
    g.lineStyle(2, colour, 1)
    g.fillStyle(colour, ZONE_FILL_ALPHA)
    const map = this.gd.map
    for (const [b, r] of d.blocks) {
      const rect = blockRect(map, b, r)
      if (!rect) continue
      const [x0, y0, x1, y1] = rect
      const n = tileToScreen(x0, y0, this.ox)
      const e = tileToScreen(x1, y0, this.ox)
      const s = tileToScreen(x1, y1, this.ox)
      const w = tileToScreen(x0, y1, this.ox)
      const pts = [
        new Phaser.Math.Vector2(n.x, n.y - HH),
        new Phaser.Math.Vector2(e.x + HW, e.y),
        new Phaser.Math.Vector2(s.x, s.y + HH),
        new Phaser.Math.Vector2(w.x - HW, w.y),
      ]
      g.fillPoints(pts, true)
      g.strokePoints(pts, true, true)
    }
    this.world.add(g)
    this.zone = g
    const label = this.labels.get(d.id)
    if (label && !this.transitioning)
      this.focusOn(label.at.x, label.at.y, 350, 0.6)
  }

  // ---------------------------------------------------------------- game events

  // While the City plays its exit (transitionOut), nothing else may move the
  // camera: CameraRig.panTo replaces the exit pan and its completion
  // callback, and the switch then waited for nav's 2-s timeout with the
  // City ignoring input (M4: a chip tap during the 200-ms pan).
  private readonly onFollowEv = (p: FollowPayload): void => {
    if (this.transitioning || this.attract) return
    if (!p || p.vehicleId === null) {
      if (this.followId !== null) this.unfollow(false)
      return
    }
    if (p.vehicleId !== this.followId) this.follow(p.vehicleId, false)
  }

  private readonly onZonePickEv = (p: ZonePickPayload): void => {
    if (this.attract) return
    this.setZone(p?.districtId ?? null)
  }

  private readonly onPanToEv = (p: PanToPayload): void => {
    if (!p || this.transitioning || this.attract) return
    if (this.followId !== null) this.unfollow(true)
    let x: number | null = null
    let y: number | null = null
    if ('vehicleId' in p) {
      const v = this.vehicles.get(p.vehicleId)
      if (v) {
        x = v.x
        y = v.y
      }
    } else if ('regionId' in p) {
      const region = this.gd.map.regions.find((r) => r.id === p.regionId)
      if (region) {
        const s = tileToScreen(
          region.labelTile[0],
          region.labelTile[1],
          this.ox,
        )
        x = s.x
        y = s.y
      }
    } else if ('buildingId' in p) {
      const b = this.buildings.get(p.buildingId)
      if (b) {
        // city-view §5.1 row 5: pan to the building and open its tooltip
        // (after the pan, so the tooltip clamps to the final view).
        this.tooltip.hide()
        this.focusOn(
          b.anchor.x,
          Math.round((b.anchor.y + b.topY) / 2),
          350,
          p.cover,
          () => {
            if (this.scene.isActive() && !b.locked) this.showTooltip(b, false)
          },
        )
      }
      return
    }
    if (x !== null && y !== null) this.focusOn(x, y, 350, p.cover)
  }

  private readonly onQualityEv = (): void => {
    this.applyQuality()
  }

  private readonly onResize = (): void => {
    this.relayout()
    if (this.tooltip.visible) this.tooltip.setClamp(this.clampRect())
  }

  private installGameEvents(): void {
    const ge = this.game.events
    ge.on(EV_FOLLOW, this.onFollowEv)
    ge.on(EV_ZONE_PICK, this.onZonePickEv)
    ge.on(EV_PAN_TO, this.onPanToEv)
    ge.on(EV_QUALITY, this.onQualityEv)
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize)
  }

  private removeGameEvents(): void {
    const ge = this.game.events
    ge.off(EV_FOLLOW, this.onFollowEv)
    ge.off(EV_ZONE_PICK, this.onZonePickEv)
    ge.off(EV_PAN_TO, this.onPanToEv)
    ge.off(EV_QUALITY, this.onQualityEv)
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize)
  }

  // ---------------------------------------------------------------- input

  private installInput(): void {
    this.gestures = new GestureClassifier(this, {
      tap: (x, y) => this.onTap(x, y),
      doubleTap: (x, y) => this.onDoubleTap(x, y),
      longPress: (x, y) => this.onLongPress(x, y),
      // Attract mode has no gestures (input is off; these guard anyway).
      panBy: (dx, dy) => {
        if (this.transitioning || this.attract) return
        if (this.followId !== null) this.unfollow(true)
        this.rig.panBy(dx, dy)
      },
      panEnd: (vx, vy) => {
        if (!this.transitioning && !this.attract) this.rig.fling(vx, vy)
      },
      pinch: (dir, cx, cy) => {
        if (!this.transitioning && !this.attract)
          this.rig.zoomAt(dir === 'in' ? 2 : 1, cx, cy)
      },
      wheel: (dir, x, y) => {
        if (!this.transitioning && !this.attract)
          this.rig.zoomAt(dir > 0 ? 2 : 1, x, y)
      },
    })
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this)
    const kb = this.input.keyboard
    if (kb) {
      this.cursors = kb.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.UP,
        down: Phaser.Input.Keyboard.KeyCodes.DOWN,
        left: Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      }) as Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>
      const onKey = (e: KeyboardEvent): void => {
        if (keysBlocked()) return // the rotate card holds the keyboard
        if (e.key === 'f' || e.key === 'F') this.followNearestToCursor()
      }
      kb.on('keydown', onKey)
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        kb.off('keydown', onKey)
      })
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this)
    })
  }

  private keyPan(): void {
    const c = this.cursors
    if (!c || this.transitioning || this.attract || keysBlocked()) return
    let dx = 0
    let dy = 0
    if (c.left.isDown) dx += KEY_PAN_PX
    if (c.right.isDown) dx -= KEY_PAN_PX
    if (c.up.isDown) dy += KEY_PAN_PX
    if (c.down.isDown) dy -= KEY_PAN_PX
    if (dx === 0 && dy === 0) return
    if (this.followId !== null) this.unfollow(true)
    this.rig.panBy(dx, dy)
    this.rig.settle()
  }

  /**
   * Screen y inside the HUD's top bar + ticker or its bottom bar: a tap there
   * that the HUD did not consume (its panel backgrounds) must not pick the
   * city under it. The chips row and toast lane fall through (§10).
   */
  private inHudBand(sy: number): boolean {
    return sy < this.L.world.y || sy >= this.L.bottomBar.y
  }

  private worldAt(sx: number, sy: number): Phaser.Math.Vector2 {
    return this.cameras.main.getWorldPoint(sx, sy)
  }

  /**
   * Vehicle whose grown sprite bounds contain the world point (nearest
   * first), unless a building drawn over it covers that point: a vehicle
   * hidden behind a tower (or parked behind the warehouse) is not what the
   * player tapped.
   */
  private vehicleAt(wx: number, wy: number): VehicleView | null {
    let best: VehicleView | null = null
    let bestD = Infinity
    for (const v of this.vehicles.values()) {
      if (!v.contains(wx, wy) || this.coveredAt(wx, wy, v.img.depth)) continue
      const d = (v.x - wx) ** 2 + (v.y - 8 - wy) ** 2
      if (d < bestD) {
        bestD = d
        best = v
      }
    }
    return best
  }

  /** An opaque pixel of the warehouse exterior at world (wx, wy). */
  private warehouseHit(wx: number, wy: number): boolean {
    const img = this.warehouse
    return (
      img !== null &&
      visibleRect(img).contains(wx, wy) &&
      (this.textures.getPixelAlpha(
        Math.floor(wx - (img.x - img.displayOriginX)),
        Math.floor(wy - (img.y - img.displayOriginY)),
        WORLD_ATLAS,
        img.frame.name,
      ) ?? 0) > 0
    )
  }

  /** A building or the warehouse drawn above `depth` covers world (wx, wy). */
  private coveredAt(wx: number, wy: number, depth: number): boolean {
    for (const b of this.buildings.values())
      if (b.depth > depth && b.hit(wx, wy)) return true
    const wh = this.warehouse
    return wh !== null && wh.depth > depth && this.warehouseHit(wx, wy)
  }

  /** City pick order (city-view §6.1, §10): what is under world (wx, wy). */
  private pick(wx: number, wy: number): Pick {
    // What you see is what you tap: the district plates and lock boards draw
    // over everything, then opaque sprite pixels front-to-back (tall
    // buildings overlap the tiles behind them), then the footprint.
    for (const l of this.labels.values())
      if (l.hit(wx, wy))
        return l.locked
          ? { kind: 'locked', district: l.id }
          : { kind: 'district', district: l.id }
    let top: BuildingView | null = null
    for (const v of this.buildings.values())
      if ((!top || v.depth > top.depth) && v.hit(wx, wy)) top = v
    const whDepth = this.warehouse?.depth ?? -1
    const whHit = this.warehouseHit(wx, wy)
    if (whHit && (!top || whDepth > top.depth)) return { kind: 'warehouse' }
    if (top) return { kind: 'building', view: top }

    const t = pickTile(wx, wy, this.ox)
    const info = this.vs.buildingAt(t.tx, t.ty)
    if (info) {
      const view = this.buildings.get(info.id)
      if (view) return { kind: 'building', view }
    }
    const block = mapBlockAt(this.gd.map, t.tx, t.ty)
    if (!block) return { kind: 'none' }
    if (block.kind === 'lot') return { kind: 'warehouse' }
    if (block.kind === 'region' && this.districts.has(block.region))
      return this.isLocked(block.region)
        ? { kind: 'locked', district: block.region }
        : { kind: 'district', district: block.region }
    return { kind: 'none' }
  }

  private emit(name: string, payload?: unknown): void {
    this.game.events.emit(name, payload)
  }

  private onTap(sx: number, sy: number): void {
    if (this.transitioning || this.attract || this.inHudBand(sy)) return
    const w = this.worldAt(sx, sy)
    const th = this.tooltip.hit(w.x, w.y)
    if (th === 'link') {
      const id = this.tooltip.districtId
      this.tooltip.hide()
      if (id) {
        this.emit(EV_UI_TAP)
        this.emit(EV_SELECT, { kind: 'district', id } satisfies SelectPayload)
      }
      return
    }
    if (th === 'body') {
      // "shown for 4 s or until another tap" (§5.2): a tap on it closes it.
      this.tooltip.hide()
      return
    }
    // A tap on a vehicle waits for its double-tap (follow), §10.
    if (this.vehicleAt(w.x, w.y)) return
    const pick = this.pick(w.x, w.y)
    switch (pick.kind) {
      case 'building':
        this.tapBuilding(pick.view)
        return
      case 'warehouse':
        this.tooltip.hide()
        this.emit(EV_UI_TAP)
        this.emit(EV_GOTO, { view: 'warehouse' })
        return
      case 'locked':
        this.tooltip.hide()
        this.emit(EV_SELECT, {
          kind: 'locked',
          id: pick.district,
        } satisfies SelectPayload)
        return
      case 'district':
        this.tooltip.hide()
        this.emit(EV_UI_TAP)
        this.emit(EV_SELECT, {
          kind: 'district',
          id: pick.district,
        } satisfies SelectPayload)
        return
      default:
        this.tooltip.hide()
    }
  }

  /** Building tap: rush if ≥ 1 waiting, else tooltip only (§6.1). */
  private tapBuilding(view: BuildingView): void {
    if (view.locked) {
      this.tooltip.hide()
      this.emit(EV_SELECT, {
        kind: 'locked',
        id: view.def.district,
      } satisfies SelectPayload)
      return
    }
    this.tipRush = null
    if (this.vs.waitingAt(view.id).length > 0) {
      const res: CommandResult = this.vs.rush(view.id)
      if (!res.ok) {
        if (res.reason === 'already-rushed')
          this.tipRush = { buildingId: view.id, kind: 'already', text: '' }
        else {
          const text = RUSH_FAIL_TEXT[res.reason]
          if (text) this.tipRush = { buildingId: view.id, kind: 'failed', text }
          this.emit(EV_UI_SFX, { name: 'deny' })
        }
      }
      this.refreshBuilding(view)
    }
    this.emit(EV_UI_TAP)
    this.showTooltip(view, false)
  }

  private tooltipModel(view: BuildingView): TooltipModel {
    const waiting = this.vs.waitingAt(view.id)
    const sorted = waiting.toSorted((a, b) => a.spawnedTick - b.spawnedTick)
    const oldest = sorted[0]
    const oldestS = oldest
      ? (this.vs.tick - oldest.spawnedTick) / TICKS_PER_S
      : null
    const rushState = this.vs.rushState(view.id)
    const remainingS = rushState
      ? Math.max(0, (rushState.untilTick - this.vs.tick) / TICKS_PER_S)
      : 0
    let rush: RushLine | null = null
    const tr = this.tipRush?.buildingId === view.id ? this.tipRush : null
    if (tr?.kind === 'failed') rush = { kind: 'failed', text: tr.text }
    else if (rushState)
      rush = {
        kind: tr?.kind === 'already' ? 'already' : 'rushed',
        remainingS,
      }
    const d = this.districts.get(view.def.district)
    const trucksOnly = d?.allowed.length === 1 && d.allowed[0] === 'truck'
    const fav = d?.favoured[0]
    const footer = d
      ? trucksOnly
        ? `${d.flavour} · trucks only`
        : fav
          ? `${d.flavour} · favours ${fav}`
          : d.flavour
      : ''
    return {
      buildingId: view.id,
      districtId: view.def.district,
      name: view.def.name,
      waiting: waiting.length,
      oldestS,
      phase: decayPhase(oldestS ?? 0, this.gd.parcels),
      sizes: sorted.map((p) => p.size.toLowerCase()),
      rush,
      footer,
      hub: hubTip(this.vs.hubs(), view.def, this.vs.tick),
    }
  }

  private showTooltip(view: BuildingView, hover: boolean): void {
    this.tooltip.show(
      this.tooltipModel(view),
      view.anchor.x,
      view.markerTop,
      this.clampRect(),
    )
    this.tooltip.hover = hover
  }

  private refreshTooltip(): void {
    const id = this.tooltip.buildingId
    if (!id) return
    const view = this.buildings.get(id)
    if (view) this.tooltip.refresh(this.tooltipModel(view))
  }

  private onDoubleTap(sx: number, sy: number): void {
    if (this.transitioning || this.attract || this.inHudBand(sy)) return
    const w = this.worldAt(sx, sy)
    const v = this.vehicleAt(w.x, w.y)
    if (v) {
      this.emit(EV_UI_TAP)
      this.follow(v.id, true)
      return
    }
    this.rig.toggleZoomAt(sx, sy)
  }

  private onLongPress(sx: number, sy: number): void {
    if (this.transitioning || this.attract || this.inHudBand(sy)) return
    const w = this.worldAt(sx, sy)
    const pick = this.pick(w.x, w.y)
    let id: string | null = null
    if (pick.kind === 'building') id = pick.view.def.district
    else if (pick.kind === 'district' || pick.kind === 'locked')
      id = pick.district
    if (!id) return
    this.tooltip.hide()
    try {
      navigator.vibrate?.(10)
    } catch {
      // vibrate is optional (iOS ignores it)
    }
    this.emit(EV_SELECT, { kind: 'district', id } satisfies SelectPayload)
  }

  private followNearestToCursor(): void {
    if (this.transitioning || this.attract) return
    const p = this.input.activePointer
    const w = this.worldAt(p.x, p.y)
    let best: VehicleView | null = null
    let bestD = Infinity
    for (const v of this.vehicles.values()) {
      const d = (v.x - w.x) ** 2 + (v.y - w.y) ** 2
      if (d < bestD) {
        bestD = d
        best = v
      }
    }
    if (best) this.follow(best.id, true)
  }

  /** Mouse hover (desktop parity): a building tooltip after 400 ms still. */
  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (p.wasTouch || p.isDown) {
      this.hover = null
      return
    }
    const h = this.hover
    if (h && Math.abs(h.x - p.x) <= 2 && Math.abs(h.y - p.y) <= 2) return
    this.hover = { x: p.x, y: p.y, since: this.time.now, done: false }
    if (this.tooltip.hover) this.tooltip.hide()
  }

  private updateHover(now: number): void {
    const h = this.hover
    if (!h || h.done || now - h.since < HOVER_MS || this.transitioning) return
    h.done = true
    if (this.tooltip.visible && !this.tooltip.hover) return
    const w = this.worldAt(h.x, h.y)
    const pick = this.pick(w.x, w.y)
    if (pick.kind === 'building' && !pick.view.locked)
      this.showTooltip(pick.view, true)
  }
}
