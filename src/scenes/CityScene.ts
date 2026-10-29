// CityScene `City` (plan.md §7; city-view.md §1-§3, §5.2, §6, §10, §11.2):
// the isometric city. Owns the ground bake (fogged `_locked` ground for locked
// regions), ONE world Layer depth-sorted by tx + ty (buildings, props, the
// warehouse exterior with its dock lights, the days-since-incident sign,
// smoke, district labels / lock signs, vehicles, badges, popups, tooltip),
// the CameraRig + GestureClassifier, the zone highlight, follow mode and the
// city side of the city → warehouse transition (nav.ts WorldTransition).
//
// Sim contract: reads the ViewSim facade only, never mutates state; commands
// go through the facade (rush). Sim events are bound with bindSim
// (attached on create/WAKE, detached on SLEEP/SHUTDOWN, syncAll on wake).
// Game events: emits pm:view, pm:select, pm:follow, pm:goto, ui:tap,
// ui:sfx; consumes pm:follow, pm:zonePick, pm:panTo.
import Phaser from 'phaser'
import {
  EV_GOTO,
  EV_VIEW,
  FADE_IN_MS,
  FADE_OUT_MS,
  FADE_RGB,
  PAN_TO_WAREHOUSE_MS,
  REG_CITY_CAM,
  type StoredCam,
  type WorldTransition,
  type WorldView,
} from '../boot/nav.ts'
import { bindSim, getAlpha, getViewSim, REG } from '../boot/simBinding.ts'
import {
  blockRect,
  mapBlockAt,
  type DistrictDef,
  type GameData,
} from '../data/index.ts'
import { GestureClassifier } from '../input/GestureClassifier.ts'
import { WORLD_ATLAS, FONT_KEY } from '../render/atlases.ts'
import {
  BuildingView,
  capTop,
  DEPTH,
  LOCKED_FILL,
  visibleRect,
  type MoodKind,
} from '../render/BuildingView.ts'
import { CameraRig } from '../render/CameraRig.ts'
import { decayPhase } from '../render/decayPhase.ts'
import { DistrictLabel } from '../render/DistrictLabel.ts'
import {
  frameOrNull,
  lockedFrame,
  SIGN_FACE,
  SMOKE_ANCHORS,
  buildingSprite,
} from '../render/frames.ts'
import { bakeGround, GROUND_Y, type GroundBake } from '../render/ground.ts'
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
import { VehicleView } from '../render/VehicleView.ts'
import type { CommandResult } from '../sim/commands.ts'
import { TICKS_PER_S } from '../sim/types.ts'
import type { ViewSim } from '../sim/view-api.ts'
import {
  BuildingTooltip,
  type ClampRect,
  type RushLine,
  type TooltipModel,
} from '../ui/BuildingTooltip.ts'
import { computeLayout, type Layout } from '../ui/layout.ts'
import { Popups, STAMP_GOLD, STAMP_GREY, type ViewRect } from '../ui/Popups.ts'
import { FONT_SIZE, paletteColour, THEME } from '../ui/theme.ts'

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
/** fx strips (4 frames each). */
const FX_POP_MS = 250
const FX_PING_MS = 300
const SMOKE_FPS = 4
const SMOKE_PUFFS = 3
const SMOKE_STEP_PX = 7
/** Dock-bay light spots on the wh_ext canvas (256×256, bottom-centre anchor):
 *  the left posts of bays 1-3 on the visible SW face (artCity hand-off). */
const BAY_LIGHTS: readonly (readonly [number, number])[] = [
  [56, 170],
  [72, 178],
  [90, 186],
]
const WH_CANVAS = 256

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
  phase: number
}

interface PropView {
  frame: string
  region: string
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
  private smoke: Smoke[] = []
  private fx: Fx[] = []
  private districts = new Map<string, DistrictDef>()
  private regionColour = new Map<string, number>()
  /** District id → fogged, as last applied to the view. */
  private lockState = new Map<string, boolean>()

  private warehouse: Phaser.GameObjects.Image | null = null
  private warehouseAnchor = { x: 0, y: 0 }
  private warehouseTier = 0
  private dockLights: Phaser.GameObjects.Image[] = []
  private signText: Phaser.GameObjects.BitmapText | null = null
  private sign: Phaser.GameObjects.Image | null = null
  private zone: Phaser.GameObjects.Graphics | null = null
  private zoneDistrict: string | null = null

  private dirty = new Set<string>()
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

  constructor() {
    super('City')
  }

  init(): void {
    this.buildings = new Map()
    this.byDistrict = new Map()
    this.vehicles = new Map()
    this.labels = new Map()
    this.props = []
    this.smoke = []
    this.fx = []
    this.lockState = new Map()
    this.dirty = new Set()
    this.popOnCreate = new Set()
    this.dockLights = []
    this.warehouse = null
    this.warehouseTier = 0
    this.sign = null
    this.signText = null
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

    this.world = this.add.layer()
    for (const d of this.gd.districts)
      this.lockState.set(d.id, this.isLockedNow(d.id))
    this.ground = bakeGround(this, map, {
      isLocked: (id) => this.lockState.get(id) === true,
    })
    this.world.add(this.ground.image)
    this.buildStatics()
    this.popups = new Popups(this, this.world)
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
        'vehicle:sold': (p) => this.onSold(p.id),
        'day:ended': () => this.refreshSign(),
        // TODO(M3): §1.4 1 s crossfade + re-baked ground crossfade + sign_pop;
        // for now the view snaps to the new lock state.
        'region:unlocked': () => this.applyLockState(),
        // TODO(M3): §9.6 fx_dust construction overlay + LEVEL stamp; for now
        // the exterior swaps to the new tier at once.
        'level:up': () => this.refreshWarehouse(),
        // TODO(M2): §3.3 fx_boom + one-day scorch overlay on the destination,
        // cam.shake(300, 0.004), cracked sign; for now the counter resets.
        'life:lost': () => this.refreshSign(),
      },
      () => this.syncAll(),
    )

    this.events.on(Phaser.Scenes.Events.WAKE, this.onWake, this)
    this.events.on(Phaser.Scenes.Events.SLEEP, this.onSleep, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this)
    this.syncAll()
    this.game.events.emit(EV_VIEW, { name: 'city' })
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
  }

  private onShutdown(): void {
    this.events.off(Phaser.Scenes.Events.WAKE, this.onWake, this)
    this.events.off(Phaser.Scenes.Events.SLEEP, this.onSleep, this)
    this.removeGameEvents()
    for (const v of this.vehicles.values()) v.destroy()
    for (const b of this.buildings.values()) b.destroy()
    for (const l of this.labels.values()) l.destroy()
    this.vehicles.clear()
    this.buildings.clear()
    this.labels.clear()
    this.popups.destroy()
    this.tooltip.destroy()
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
    const left = at.x - WH_CANVAS / 2
    const top = at.y - WH_CANVAS
    BAY_LIGHTS.forEach(([bx, by], i) => {
      const img = this.add
        .image(left + bx, top + by, WORLD_ATLAS, 'wh_dock_light_green')
        .setOrigin(0.5, 1)
        .setDepth(footprintDepth(wh.tile, wh.footprint) + DEPTH.bell)
        .setVisible(false)
      img.setData('dock', i)
      this.world.add(img)
      this.dockLights.push(img)
    })

    // Props (static Images; `_locked` frame while their region is fogged).
    for (const pr of map.props) {
      tileToScreen(pr.tile[0], pr.tile[1], this.ox, at)
      const pv: PropView = {
        frame: PROP_ALIAS[pr.frame] ?? pr.frame,
        region: pr.region,
        img: null,
        x: Math.round(at.x),
        y: Math.round(at.y + HH),
        depth: pr.tile[0] + pr.tile[1] + 0.01,
      }
      this.props.push(pv)
      this.placeProp(pv)
    }

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
  }

  private placeProp(pv: PropView): void {
    pv.img?.destroy()
    pv.img = null
    const locked = this.isLocked(pv.region)
    const name = lockedFrame(pv.frame, locked)
    if (!name) return
    const img = this.add
      .image(pv.x, pv.y, WORLD_ATLAS, name)
      .setOrigin(0.5, 1)
      .setDepth(pv.depth)
    if (locked && !name.endsWith('_locked'))
      img.setTint(LOCKED_FILL).setTintMode(Phaser.TintModes.FILL)
    this.world.add(img)
    pv.img = img
  }

  /** Smoke puffs over the live Industrial chimneys (manifest smokeAnchors). */
  private buildSmoke(): void {
    for (const s of this.smoke) for (const p of s.puffs) p.destroy()
    this.smoke = []
    if (!frameOrNull('fx_smoke_f0')) return
    let phase = 0
    for (const view of this.buildings.values()) {
      if (view.locked) continue
      const anchors = SMOKE_ANCHORS[buildingSprite(view.id)]
      if (!anchors || !view.image) continue
      // Anchors are canvas pixels; Image width/height = the source canvas.
      const cw = view.image.width
      const ch = view.image.height
      for (const [ax, ay] of anchors) {
        const x = view.anchor.x - cw / 2 + ax
        const y = view.anchor.y - ch + ay
        const puffs: Phaser.GameObjects.Image[] = []
        for (let k = 0; k < SMOKE_PUFFS; k++) {
          const img = this.add
            .image(x, y - k * SMOKE_STEP_PX, WORLD_ATLAS, 'fx_smoke_f0')
            .setOrigin(0.5, 1)
            .setDepth(view.depth + DEPTH.smoke)
          this.world.add(img)
          puffs.push(img)
        }
        this.smoke.push({ building: view.id, puffs, phase: phase++ })
      }
    }
  }

  private warehouseCentre(): { x: number; y: number } {
    const img = this.warehouse
    if (!img)
      return { x: this.warehouseAnchor.x, y: this.warehouseAnchor.y - 64 }
    const r = visibleRect(img)
    return { x: Math.round(r.centerX), y: Math.round(r.centerY) }
  }

  private refreshWarehouse(): void {
    const level = this.vs.level
    const row = this.gd.levels.find((l) => l.level === level)
    const tier = row?.warehouseTier ?? 1
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
  }

  private refreshSign(): void {
    const sign = this.sign
    const t = this.signText
    if (!sign || !t) return
    const n = this.vs.daysSinceIncident
    t.setText(`${n} ${n === 1 ? 'day' : 'days'}`)
    const left = sign.x - sign.width / 2
    const top = sign.y - sign.height
    const f = SIGN_FACE
    t.setPosition(
      Math.round(left + f.x + (f.w - t.width) / 2),
      capTop(top + f.y + f.h / 2),
    )
  }

  /** Apply region lock changes (create, wake, region:unlocked). */
  private applyLockState(): void {
    let changed = false
    for (const d of this.gd.districts) {
      const locked = this.isLockedNow(d.id)
      if (this.lockState.get(d.id) === locked) continue
      this.lockState.set(d.id, locked)
      changed = true
      for (const v of this.byDistrict.get(d.id) ?? []) v.setLocked(locked)
      for (const pv of this.props) if (pv.region === d.id) this.placeProp(pv)
      this.labels.get(d.id)?.setLocked(locked)
    }
    if (!changed) return
    this.ground?.rebake((id) => this.lockState.get(id) === true)
    this.buildSmoke()
  }

  // ---------------------------------------------------------------- sync

  /** Rebuild everything from sim state (create, WAKE, sim swap). */
  private syncAll(): void {
    if (!this.world) return
    this.applyLockState()
    this.refreshWarehouse()
    this.refreshSign()
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
    for (const d of this.gd.districts) {
      if (d.kind !== 'district') continue // hubs have no satisfaction (§9.1)
      const st = this.vs.districtStats(d.id)
      if (st) this.applyMood(d.id, st.satisfaction)
    }
    this.refreshMarkers()
  }

  /** Waiting badges and rush bells of every live building (2 Hz + on sync). */
  private refreshMarkers(): void {
    for (const view of this.buildings.values()) this.refreshBuilding(view)
    this.dirty.clear()
  }

  private refreshBuilding(view: BuildingView): void {
    if (view.locked) return
    const waiting = this.vs.waitingAt(view.id)
    let oldest = Infinity
    for (const p of waiting) oldest = Math.min(oldest, p.spawnedTick)
    const ageS = waiting.length > 0 ? (this.vs.tick - oldest) / TICKS_PER_S : 0
    view.setWaiting(waiting.length, decayPhase(ageS, this.gd.parcels))
    const rush = this.vs.rushState(view.id)
    if (rush) {
      const total = this.gd.vehicles.rushExpireS * TICKS_PER_S
      const left = Math.max(0, rush.untilTick - this.vs.tick)
      view.setRush(Math.min(1, left / total))
    } else view.setRush(null)
  }

  private applyMood(districtId: string, value: number): void {
    const s = this.gd.economy.satisfaction
    const kind: MoodKind =
      value < s.loudBelow ? 'unhappy' : value >= s.happyAbove ? 'happy' : null
    const locked = this.isLocked(districtId)
    for (const v of this.byDistrict.get(districtId) ?? [])
      v.setMood(locked ? null : kind)
    this.labels.get(districtId)?.setAngry(!locked && value < s.loudBelow)
  }

  // ---------------------------------------------------------------- update

  update(_time: number, delta: number): void {
    const now = this.time.now
    this.rig.update(delta)
    this.gestures.update()
    this.keyPan()

    this.updateVehicles(now)
    this.popups.update(delta)
    this.tooltip.update(delta)
    this.updateFx(now)
    this.updateSmoke(now)
    this.updateDockLights(now)
    if (this.zone)
      this.zone.setAlpha(
        0.6 + 0.2 * Math.sin((2 * Math.PI * now) / ZONE_PULSE_MS),
      )

    for (const id of this.dirty) {
      const v = this.buildings.get(id)
      if (v) this.refreshBuilding(v)
    }
    this.dirty.clear()
    this.refreshAcc += delta
    if (this.refreshAcc >= REFRESH_MS) {
      this.refreshAcc = 0
      this.refreshMarkers()
      this.refreshTooltip()
    }
    this.updateHover(now)
  }

  private updateVehicles(now: number): void {
    const alpha = getAlpha(this)
    const snaps = this.vs.vehicles
    let seen = 0
    for (const v of snaps) {
      let view = this.vehicles.get(v.id)
      if (!view) {
        view = new VehicleView(this, this.world, this.ox, v)
        this.vehicles.set(v.id, view)
      }
      seen++
      const colour =
        v.zone === 'any' ? null : (this.regionColour.get(v.zone) ?? null)
      view.update(v, alpha, now, colour)
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
    const docks = this.vs.docks.length
    const red = this.queueN > 0 || this.stalled
    const blinkOn = !this.stalled || Math.floor(now / LIGHT_BLINK_MS) % 2 === 0
    this.dockLights.forEach((img, i) => {
      if (i >= docks) {
        img.setVisible(false)
        return
      }
      const f = red ? 'wh_dock_light_red' : 'wh_dock_light_green'
      if (img.frame.name !== f) img.setFrame(f, false, false)
      img.setVisible(blinkOn)
    })
  }

  private updateSmoke(now: number): void {
    const step = Math.floor((now * SMOKE_FPS) / 1000)
    for (const s of this.smoke)
      s.puffs.forEach((p, k) => {
        const f = `fx_smoke_f${(step + s.phase + k) % 4}`
        if (p.frame.name !== f) p.setFrame(f, false, false)
      })
  }

  private playFx(
    x: number,
    y: number,
    stem: string,
    ms: number,
    reverse: boolean,
    depth: number,
  ): void {
    const frames = [0, 1, 2, 3].map((i) => `${stem}_f${i}`)
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
    const icon = `ic_parcel_${p.size.toLowerCase()}`
    this.popups.pickup(
      this.viewRect,
      b.id,
      b.door.x,
      b.door.y - POPUP_LIFT,
      icon,
    )
    const v = this.vehicles.get(vehicleId)
    if (v)
      this.popups.hop(this.viewRect, b.door.x, b.door.y, v.x, v.y - 8, icon)
  }

  private onDelivered(id: number, paid: number, onTime: boolean): void {
    const p = this.parcel(id)
    if (!p) return
    this.dirty.add(p.dest)
    const b = this.buildings.get(p.dest)
    if (!b) return
    const v = p.vehicleId !== null ? this.vehicles.get(p.vehicleId) : undefined
    if (v)
      this.popups.hop(
        this.viewRect,
        v.x,
        v.y - 8,
        b.door.x,
        b.door.y,
        `ic_parcel_${p.size.toLowerCase()}`,
      )
    this.popups.delivered(
      this.viewRect,
      b.id,
      b.door.x,
      b.door.y - POPUP_LIFT,
      paid,
      onTime,
    )
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
      if (!reducedMotion()) this.cameras.main.shake(120, 0.002)
    } else {
      this.popups.stamp(
        this.viewRect,
        'warehouse',
        roof.x,
        roof.y,
        `OOPS −$${this.gd.economy.wrongTossFee}`,
        STAMP_GREY,
      )
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

  /** The uncovered city area in world coordinates (tooltip clamp). */
  private clampRect(): ClampRect {
    const cam = this.cameras.main
    const v = cam.worldView
    const z = cam.zoom
    return {
      x: v.x,
      y: v.y + this.L.world.y / z,
      w: v.width,
      h: this.L.world.h / z,
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
    if (label) this.focusOn(label.at.x, label.at.y, 350, 0.6)
  }

  // ---------------------------------------------------------------- game events

  private readonly onFollowEv = (p: FollowPayload): void => {
    if (!p || p.vehicleId === null) {
      if (this.followId !== null) this.unfollow(false)
      return
    }
    if (p.vehicleId !== this.followId) this.follow(p.vehicleId, false)
  }

  private readonly onZonePickEv = (p: ZonePickPayload): void => {
    this.setZone(p?.districtId ?? null)
  }

  private readonly onPanToEv = (p: PanToPayload): void => {
    if (!p) return
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

  private readonly onResize = (): void => {
    this.relayout()
    if (this.tooltip.visible) this.tooltip.setClamp(this.clampRect())
  }

  private installGameEvents(): void {
    const ge = this.game.events
    ge.on(EV_FOLLOW, this.onFollowEv)
    ge.on(EV_ZONE_PICK, this.onZonePickEv)
    ge.on(EV_PAN_TO, this.onPanToEv)
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize)
  }

  private removeGameEvents(): void {
    const ge = this.game.events
    ge.off(EV_FOLLOW, this.onFollowEv)
    ge.off(EV_ZONE_PICK, this.onZonePickEv)
    ge.off(EV_PAN_TO, this.onPanToEv)
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize)
  }

  // ---------------------------------------------------------------- input

  private installInput(): void {
    this.gestures = new GestureClassifier(this, {
      tap: (x, y) => this.onTap(x, y),
      doubleTap: (x, y) => this.onDoubleTap(x, y),
      longPress: (x, y) => this.onLongPress(x, y),
      panBy: (dx, dy) => {
        if (this.transitioning) return
        if (this.followId !== null) this.unfollow(true)
        this.rig.panBy(dx, dy)
      },
      panEnd: (vx, vy) => {
        if (!this.transitioning) this.rig.fling(vx, vy)
      },
      pinch: (dir, cx, cy) => {
        if (!this.transitioning) this.rig.zoomAt(dir === 'in' ? 2 : 1, cx, cy)
      },
      wheel: (dir, x, y) => {
        if (!this.transitioning) this.rig.zoomAt(dir > 0 ? 2 : 1, x, y)
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
    if (!c || this.transitioning) return
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

  /** Vehicle whose grown sprite bounds contain the world point (nearest first). */
  private vehicleAt(wx: number, wy: number): VehicleView | null {
    let best: VehicleView | null = null
    let bestD = Infinity
    for (const v of this.vehicles.values()) {
      if (!v.contains(wx, wy)) continue
      const d = (v.x - wx) ** 2 + (v.y - 8 - wy) ** 2
      if (d < bestD) {
        bestD = d
        best = v
      }
    }
    return best
  }

  /** City pick order (city-view §6.1, §10): what is under world (wx, wy). */
  private pick(wx: number, wy: number): Pick {
    // What you see is what you tap: opaque sprite pixels front-to-back first
    // (tall buildings overlap the tiles behind them), then the footprint.
    let top: BuildingView | null = null
    for (const v of this.buildings.values())
      if ((!top || v.depth > top.depth) && v.hit(wx, wy)) top = v
    const whImg = this.warehouse
    const whDepth = whImg?.depth ?? -1
    const whHit =
      whImg !== null &&
      visibleRect(whImg).contains(wx, wy) &&
      (this.textures.getPixelAlpha(
        Math.floor(wx - (whImg.x - whImg.displayOriginX)),
        Math.floor(wy - (whImg.y - whImg.displayOriginY)),
        WORLD_ATLAS,
        whImg.frame.name,
      ) ?? 0) > 0
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
    if (this.transitioning || this.inHudBand(sy)) return
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
    if (this.transitioning || this.inHudBand(sy)) return
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
    if (this.transitioning || this.inHudBand(sy)) return
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
    if (this.transitioning) return
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
