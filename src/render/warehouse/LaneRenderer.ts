// LaneRenderer (warehouse-view.md §1.2-§1.9, §1.13, §3.3-§3.4, §4, §5, §6,
// §8): everything in the room that is not the dock or a worker — floor,
// walls, belts, chute, slots (outlines, "+", locks, machines, desk), the Hold
// Bay rack with its lamp and bays, the Quarantine Bin, the shelf grid and
// badge, tier props, the north-wall sign, the readout strip, the parcel
// sprite pool and the stall visuals.
//
// Model: the sim owns where every parcel is (node + queue index / station);
// this renderer owns the tweens. Every frame `reconcile()` reads the lane
// nodes and moves each pooled parcel sprite to its node anchor along
// `layout.pathBetween` at 160 px/s (120–400 ms), so a burst of events (or a
// long __pm.advance) never desynchronises the view. Sim events only add the
// effects state cannot show: the catch moment (§3.3) and the Toss outcomes
// (§3.4) are queued per parcel and run before the sprite follows state again.
// Shelf parcels are 10 × 10 minis drawn from `shelf.ids` (oldest first);
// a sprite flying to the shelf hides its mini until it lands. Hold Bay
// parcels sit on the sim's STABLE bay (`holdBay.items[].bay`, M3): a Toss
// never slides the others down the rack. Draw order inside the parcel layer:
// the newest sprite on top, except that a parcel mid-catch or dark (flagged)
// always stays above the plain ones (a sprite acquired after the catch must
// not cover it).
//
// Tiers (§5): `applyTier(t, fade)` swaps every tier-keyed frame (floor,
// walls, wall face, sign, shelf, wanted poster) under a fading copy of the
// old look, and fades the tier-only parts (bulb ↔ strip lights, cardboard ↔
// shelving unit, the INTAKE / HOLD / SHELF / QUARANTINE plates, the sign
// text tint) over the same 400 ms. A level-up while inside cross-fades, then
// unrolls the newly live slot (§1.6: lock look out, belt tiles in top to
// bottom 75 ms apart, then the empty outline and its "+"); waking after a
// level-up applies the tier and the live slot at once (§5.3).
//
// No slot index is computed here: positions come from FixedLaneLayout by
// node id, order from `next` edges, caps and locks from the sim / data.
//
// M6 (spec-build2 §2.4, §2.6): every desk fixture draws the same `desk`
// sprite in whichever slot holds it (desk 1 and desk 2 alike); the Hold Bay
// station (RoomLayout HOLD_STATION) shows a dashed outline + lock + `Lv2`
// while locked, the `hold_station` podium once live (a dashed outline until
// that frame is drawn), a "+" while empty, the Sorter Arm (`sorter_arm_f0`,
// a back-layer fixture; `onArmToss` plays reach → toss → rest) when one sits
// there and its art is packed, and the rack lamp wears a small yellow `S`
// while an active sorter is on duty. State-derived each frame from
// `ViewSim.holdStation` (stationLook).
import Phaser from 'phaser'
import type { GameData } from '../../data/types.ts'
import type { LaneNode, Parcel, Size, Strain } from '../../sim/types.ts'
import type {
  HoldStationView,
  PersonView,
  ViewSim,
} from '../../sim/view-api.ts'
import { addPanel } from '../../ui/Panel.ts'
import { flaggerOf, shownTrait } from '../../ui/warehouse/HoldBayCard.ts'
import { detectionTone, TONE_LIGHT } from '../../ui/ShieldPopover.ts'
import { addText, textTop } from '../../ui/text.ts'
import { PALETTE, THEME } from '../../ui/theme.ts'
import { valueFactor } from '../decayPhase.ts'
import { FONT_KEY, ROOM_FONT_KEY } from '../atlases.ts'
import { atlasOf, frameOrNull, roomAtlas } from '../frames.ts'
import {
  BELT_CX,
  BIN_COUNTER,
  BULB,
  bayRect,
  DOOR_POINT,
  FixedLaneLayout,
  HOLD_STATION,
  POSTER,
  PLATE_H,
  PLATE_PAD,
  PROPS_T1,
  PROPS_T2,
  RACK,
  RACK_LAMP,
  RACK_S_BADGE,
  READOUT_GAP,
  READOUT_H,
  ROOM_COLS,
  ROOM_H,
  ROOM_ROWS,
  ROOM_W,
  SHELF_BADGE,
  SHELF_COLS,
  SHELF_ROWS,
  shelfCell,
  SIGN,
  SIGN_TEXT,
  SIGNAGE,
  SORTER_ARM_AT,
  SORTER_STAND,
  STRIP_LIGHTS,
  TILE,
  type BeltTile,
  type Point,
  type Rect,
} from './RoomLayout.ts'
import {
  DIVERT_DOWN_MAX_MS,
  DIVERT_IN_MS,
  DIVERT_OUT_MS,
  FLIP_AT_MS,
  FLIP_MS,
  Fx,
  moveAlong,
  moveLegs,
  MOVE_MIN_MS,
  PARCEL_PX_PER_S,
  SLIDE_AT_MS,
  type MoveOpts,
} from './Fx.ts'

type Img = Phaser.GameObjects.Image
type Txt = Phaser.GameObjects.BitmapText
type Box = Phaser.GameObjects.Container

// ---- room layers (§1.13 depth order as child containers, back to front) ----

export interface RoomLayers {
  /** The room container (screen px); every layer is a child, room px. */
  root: Box
  floor: Box
  walls: Box
  belts: Box
  fixtures: Box
  tail: Box
  parcels: Box
  machines: Box
  workers: Box
  badges: Box
  fx: Box
}

export function createRoomLayers(
  scene: Phaser.Scene,
  x: number,
  y: number,
): RoomLayers {
  const mk = (): Box => scene.add.container(0, 0)
  const floor = mk()
  const walls = mk()
  const belts = mk()
  const fixtures = mk()
  const tail = mk()
  const parcels = mk()
  const machines = mk()
  const workers = mk()
  const badges = mk()
  const fx = mk()
  const root = scene.add.container(x, y, [
    floor,
    walls,
    belts,
    fixtures,
    tail,
    parcels,
    machines,
    workers,
    badges,
    fx,
  ])
  return {
    root,
    floor,
    walls,
    belts,
    fixtures,
    tail,
    parcels,
    machines,
    workers,
    badges,
    fx,
  }
}

// ---- constants ----------------------------------------------------------------

/** §1.5 pool: conveyor 6 + 4 × (2 + 3) + Hold Bay 5 + in-flight margin. */
export const MAX_PARCELS = 48
const BELT_FPS = 8
const MACHINE_SCAN_FPS = 4
const SHAKER_SCAN_FPS = 8
const STALL_PULSE_MS = 500
const PULSE_LOW_ALPHA = 0.35
const LAMP_BLINK_MS = 500
const RING_REFRESH_MS = 500
const BULB_FLICKER_EVERY_MS = 7000
const BULB_FLICKER_MS = 120
const CRACK_FPS = 6
const SIGN_FADE_MS = 200
export const TIER_FADE_MS = 400
export const UNROLL_STEP_MS = 75
/** The slot's lock look fades out this long as the unroll starts. */
const UNLOCK_FADE_MS = 150
const POP_MS = 150
const UNLOAD_MS = 200
const TOSS_MS = 250
const LOAD_MS = 300
const SHELF_POP_MS = 200
const LID_MS = 300
/** Sorter Arm toss: reach, toss, rest — one frame each (§3.4 pace). */
const ARM_FRAME_MS = 120
const OOPS_LINES_MS = 1200
/** The plated OOPS stamp rises less so it stays clear of the rack. */
const OOPS_RISE = 12
const MAX_FLIGHTS = 8
/** Shelf check badge (16 × 16, ~14 × 10 visible) up-right of its mini. */
const CHECK_DX = 4
const CHECK_DY = -9
const EMPTY_OUTLINE_ALPHA = 0.4
const LOCKED_ALPHA = 0.6
const LOCKED_BELT_ALPHA = 0.5
/** Spec §6.6 stamp colours (gold / grey). */
const STAMP_GOLD = THEME.gold
const STAMP_GREY = PALETTE.grey3

const SIZE_KEY: Record<Size, string> = { S: 's', M: 'm', L: 'l', XL: 'xl' }

export const parcelFrame = (size: Size, dark = false): string =>
  `parcel_${SIZE_KEY[size]}${dark ? '_mal' : ''}`
export const miniFrame = (size: Size): string => `parcel_mini_${SIZE_KEY[size]}`
const flipFrames = (size: Size): string[] =>
  [0, 1, 2, 3, 4, 5].map((i) => `parcel_${SIZE_KEY[size]}_flip_f${i}`)

/** Visual tier (only t1 / t2 art exists in playtest 1). */
export function visualTier(data: GameData, level: number): 1 | 2 {
  const row = data.levels.find((l) => l.level === level)
  return (row?.warehouseTier ?? 1) >= 2 ? 2 : 1
}

/** `Lane: 15/min · Detection ` + `97%` (§1.9), or the stalled caption (§4). */
export function readoutParts(
  ratePerMin: number,
  detectionPct: number,
  stalled: { reason: string } | null,
): { lead: string; mid: string; pct: string; stalled: boolean } {
  const pct = `${Math.round(detectionPct)}%`
  // `mid` stays light while stalled: only the rate segment turns red (§1.9),
  // so "Detection" never reads as the failing part (UX M2 review).
  // (Separators trail each part: a BitmapText's width counts trailing
  // spaces, the old single-text strip relied on it too.)
  const mid = '· Detection '
  if (stalled) {
    const why =
      stalled.reason === 'holdBayFull'
        ? 'Hold Bay full'
        : stalled.reason === 'shelfFull'
          ? 'Shelf full'
          : 'Lane jammed'
    return { lead: `Lane: STALLED (${why}) `, mid, pct, stalled: true }
  }
  return {
    lead: `Lane: ${Math.round(ratePerMin)}/min `,
    mid,
    pct,
    stalled: false,
  }
}

/**
 * Rack position of every held parcel: the sim's stable `bay` (M3: a parcel
 * keeps the bay it arrived in until it leaves; gaps allowed), else — an item
 * the facade has not reported — the lowest bay nobody holds. Parcel id → bay.
 */
export function holdBayPositions(
  queue: readonly number[],
  items: readonly { parcelId: number; bay: number }[],
): Map<number, number> {
  const out = new Map<number, number>()
  const used = new Set<number>()
  for (const it of items) {
    if (!queue.includes(it.parcelId) || used.has(it.bay)) continue
    out.set(it.parcelId, it.bay)
    used.add(it.bay)
  }
  for (const id of queue) {
    if (out.has(id)) continue
    let b = 0
    while (used.has(b)) b += 1
    out.set(id, b)
    used.add(b)
  }
  return out
}

// ---- M6 people reads (doc §3.4 ViewSim.people / holdStation) -----------------

/** The PersonView fields the room reads (the pure helpers take this subset). */
export type RoomPerson = Pick<
  PersonView,
  'id' | 'role' | 'name' | 'look' | 'active' | 'unpaid' | 'nodeId'
>

/** The HoldStationView fields the room reads (its sorter narrowed to RoomPerson). */
export type RoomStation = Omit<HoldStationView, 'sorter'> & {
  readonly sorter: RoomPerson | null
}

/** What the Hold Bay station cell shows (B2 §2.6; one state → one look). */
export interface StationLook {
  /** Dashed outline: 'locked' (with the lock + level tag), 'empty' (live, no podium art yet), none. */
  outline: 'locked' | 'empty' | null
  /** `Lv2` under the lock while locked, else null. */
  lockText: string | null
  /** The `hold_station` podium. */
  podium: boolean
  /** The "+" over a live, empty station (like an empty slot, §1.6). */
  plus: boolean
  /** The Sorter Arm's sprite (only once its art exists, M9). */
  arm: boolean
  /** The rack lamp's `S` badge: an active sorter is on duty. */
  sBadge: boolean
}

const NO_STATION: StationLook = {
  outline: null,
  lockText: null,
  podium: false,
  plus: false,
  arm: false,
  sBadge: false,
}

/**
 * The station's look for a HoldStationView (null = a facade without the
 * station: nothing drawn). `art` says which frames the atlas holds now
 * (`hold_station`, `sorter_arm_f0`), so the room works before the art lands.
 */
export function stationLook(
  st: RoomStation | null,
  art: { podium: boolean; arm: boolean },
): StationLook {
  if (!st) return NO_STATION
  if (!st.unlocked)
    return { ...NO_STATION, outline: 'locked', lockText: `Lv${st.unlockLevel}` }
  const arm = st.kind === 'sorter_arm' && art.arm
  const podium = art.podium && !arm
  return {
    outline: podium || arm ? null : 'empty',
    lockText: null,
    podium,
    plus: st.kind === null,
    arm,
    sBadge: st.kind === 'sorter' && st.sorter?.active === true,
  }
}

/** A flagged-looking parcel: flagged and still in a slot or the Hold Bay. */
function looksFlagged(p: Parcel | null): boolean {
  return (
    p !== null &&
    p.flaggedBy !== null &&
    (p.state === 'held' || p.state === 'in_slot')
  )
}

/**
 * The player cleared it from the Hold Bay (holdbay.ts clearParcel traces
 * `{what: 'cleared', ref: <hold node>}`), for the shelf check badge on syncAll.
 */
function wasCleared(p: Parcel, holdId: string): boolean {
  return p.trace.some((t) => t.what === 'cleared' && t.ref === holdId)
}

// ---- parcel sprites ---------------------------------------------------------------

type Action = (done: () => void) => void

interface PSprite {
  id: number
  img: Img
  size: Size
  label: string
  /** Node it rests at / is heading to (null = not in the lane yet). */
  node: string | null
  at: Point
  bay: number | null
  actions: Action[]
  running: boolean
  tween: Phaser.Tweens.Tween | null
  dark: boolean
  strain: Strain | null
  icon: Img | null
  check: Img | null
  ring: Img | null
  ringFrame: number
  /** Leaving the lane (to the shelf, the bin, the door); reconcile skips it. */
  leaving: 'shelf' | 'bin' | 'gone' | null
  /** parcel:flagged until it turns dark: drawn above later sprites. */
  catching: boolean
  seen: boolean
  alive: boolean
}

interface SlotView {
  nodeId: string
  rect: Rect
  empty: Img
  locked: Img
  lock: Img
  lockText: Txt
  plus: Img
  outlet: Img | null
  belts: Img[]
  machine: Img | null
  desk: Img | null
  fixtureKey: string
  scanFrames: string[]
  idleFrame: string
  scanFps: number
  isLocked: boolean
  lifted: boolean
  /** Unlocked, still showing the lock look until its unroll starts. */
  unrollPending: boolean
  unrollTimer: Phaser.Time.TimerEvent | null
}

interface Want {
  nodeId: string
  point: Point
  bay: number | null
}

export interface TossInfo {
  id: number
  wasMalware: boolean
  bounty: number
  /** No downstream node holds a checker with ≥ 1 station (§3.4). */
  closeCall: boolean
  label: string
}

export class LaneRenderer {
  readonly scene: Phaser.Scene
  readonly layout: FixedLaneLayout
  private L: RoomLayers
  private vs: ViewSim
  private fx: Fx
  private gd: GameData

  private tier: 1 | 2 = 1
  private floorImgs: { img: Img; c: number; r: number }[] = []
  private wallImgs: Img[] = []
  private faceImgs: Img[] = []
  private sign!: Img
  private signText!: Txt
  private crack!: Img
  private cracked = false
  private bulb!: Img
  private strips: Img[] = []
  private props1: Img[] = []
  private props2: Img[] = []
  private poster!: Img
  private plates: Box[] = []
  private shelfImg!: Img
  private beltImgs: { img: Img; tile: BeltTile; frame: number }[] = []
  private slots = new Map<string, SlotView>()
  private bays: Img[] = []
  private bayLocks: { icon: Img; text: Txt }[] = []
  private rackLamp!: Img
  private sBadge!: Txt
  private stPodium: Img | null = null
  private stOutline!: Img
  private stLock!: Img
  private stLockText!: Txt
  private stPlus!: Img
  private stArm: Img | null = null
  private armTimer: Phaser.Time.TimerEvent | null = null
  private stationKey = ''
  private bin!: Img
  private binText!: Txt
  private ext!: Img
  private extLock!: Img
  private extText!: Txt
  private minis: Img[] = []
  private miniChecks = new Map<number, Img>()
  private badge!: Img
  private badgeText!: Txt
  private readoutPanel!: Phaser.GameObjects.NineSlice
  private readoutLead!: Txt
  private readoutMid!: Txt
  private readoutPct!: Txt
  private stallBox: Phaser.GameObjects.Graphics | null = null
  private stallKey = ''
  private candidates: Phaser.GameObjects.Graphics[] = []
  private pulses: { g: Phaser.GameObjects.Graphics; until: number }[] = []

  private pool: Img[] = []
  private sprites = new Map<number, PSprite>()
  private wants = new Map<number, Want>()
  private cleared = new Set<number>()
  private prevShelf: number[] = []
  private flights = 0
  private poolWarned = false

  private beltPhase = 0
  private beltFrame = 0
  private machinePhase = 0
  private blinkPhase = 0
  private ringAcc = 0
  private bulbAcc = 0
  private readoutKey = ''
  private lidTimer: Phaser.Time.TimerEvent | null = null
  private instant = false
  private lockedSlots = new Set<string>()

  constructor(
    scene: Phaser.Scene,
    layers: RoomLayers,
    layout: FixedLaneLayout,
    vs: ViewSim,
    fx: Fx,
  ) {
    this.scene = scene
    this.L = layers
    this.layout = layout
    this.vs = vs
    this.fx = fx
    this.gd = vs.data
    this.tier = visualTier(this.gd, vs.level)
    this.buildRoom()
    this.buildReadout()
    for (let i = 0; i < MAX_PARCELS; i++) {
      const img = scene.add
        .image(0, 0, atlasOf('parcel_s'), 'parcel_s')
        .setVisible(false)
        .setActive(false)
      this.pool.push(img)
      this.L.parcels.add(img)
    }
  }

  // ================================================================ static room

  private img(
    layer: Box,
    x: number,
    y: number,
    frame: string,
    originX = 0,
    originY = 0,
  ): Img {
    const f = frameOrNull(frame) ?? '__MISSING'
    const i = this.scene.add
      .image(Math.round(x), Math.round(y), this.atlasFor(layer, f), f)
      .setOrigin(originX, originY)
    layer.add(i)
    return i
  }

  /**
   * Back layers (floor, walls, belts, fixtures, tail: static room art) bind
   * `interior`, front layers (parcels, machines, workers, badges, fx, with
   * their panels and text) bind `world`: one texture switch per frame on the
   * phone's one-texture batches (spec-build2 §6.8, tools/art/atlas.ts).
   */
  private atlasFor(layer: Box, frame: string): string {
    const L = this.L
    const back =
      layer === L.floor ||
      layer === L.walls ||
      layer === L.belts ||
      layer === L.fixtures ||
      layer === L.tail
    return back ? roomAtlas(frame) : atlasOf(frame)
  }

  private text(layer: Box, x: number, y: number, s: string, tint: number): Txt {
    const t = addText(this.scene, x, y, s, { tint })
    layer.add(t)
    return t
  }

  private floorFrame(c: number, r: number): string {
    if (this.tier === 2) return c === 4 ? 'floor_t2_lane' : 'floor_t2'
    // Seeded crack variants (§5.1): a cheap hash of (c, r).
    const h = (c * 73856093) ^ (r * 19349663)
    const v = (h >>> 0) % 7
    return `floor_t1_${v === 0 ? 1 : v === 3 ? 2 : 0}`
  }

  private buildRoom(): void {
    const t = this.tier
    const lay = this.layout
    // Floor x 32–319, y 32–447 (9 × 13 tiles).
    for (let r = 1; r < ROOM_ROWS; r++) {
      for (let c = 1; c < ROOM_COLS - 1; c++) {
        const img = this.img(
          this.L.floor,
          c * TILE,
          r * TILE,
          this.floorFrame(c, r),
        )
        this.floorImgs.push({ img, c, r })
      }
    }
    // Walls: west c0 / east c10 below the north face r0.
    for (let r = 1; r < ROOM_ROWS; r++) {
      this.wallImgs.push(this.img(this.L.walls, 0, r * TILE, `wall_t${t}`))
      this.wallImgs.push(
        this.img(this.L.walls, ROOM_W - TILE, r * TILE, `wall_t${t}`),
      )
    }
    for (let c = 0; c < ROOM_COLS; c++)
      this.faceImgs.push(this.img(this.L.walls, c * TILE, 0, `wallface_t${t}`))
    const base = this.scene.add
      .rectangle(0, ROOM_H - 2, ROOM_W, 2, PALETTE.outline, 1)
      .setOrigin(0, 0)
    this.L.walls.add(base)
    // North-wall sign, crack overlay, lights.
    this.sign = this.img(this.L.walls, SIGN.x, SIGN.y, `sign_t${t}`)
    this.signText = this.text(this.L.walls, SIGN_TEXT.x, 0, '', THEME.textLight)
    // the walls are a back layer: the same m5x7 from `interior` keeps the
    // sign text in the back batch (PreloadScene registers ROOM_FONT_KEY)
    if (this.scene.cache.bitmapFont.has(ROOM_FONT_KEY)) {
      this.signText.setFont(ROOM_FONT_KEY)
    }
    this.crack = this.img(this.L.walls, SIGN.x, SIGN.y, 'sign_crack_1')
    this.crack.setVisible(false)
    this.bulb = this.img(this.L.walls, BULB.x, BULB.y, 'bulb_0')
    for (const p of STRIP_LIGHTS)
      this.strips.push(this.img(this.L.walls, p.x, p.y, 'strip_light'))

    // Belts (per edge, §8) and the chute (each slot's divert edge).
    for (const tile of lay.beltTiles()) {
      const img = this.img(this.L.belts, tile.x, tile.y, `${tile.stem}_0`)
      this.beltImgs.push({ img, tile, frame: 0 })
    }
    for (const p of lay.chuteSegments())
      this.img(this.L.belts, p.x, p.y, 'chute_v')

    // Slots in the belt column.
    for (const node of this.vs.lane.nodes()) {
      if (node.kind !== 'slot' || !lay.isBeltSlot(node.id)) continue
      this.slots.set(node.id, this.buildSlot(node.id))
    }
    // Extension strip (slots past the column, §6).
    const er = lay.extRect()
    this.ext = this.img(this.L.badges, er.x, er.y, 'ext_outline')
    this.ext.setAlpha(LOCKED_ALPHA)
    this.extLock = this.img(this.L.badges, er.x + 6, er.y + 4, 'ic_lock')
    this.extText = this.text(
      this.L.badges,
      er.x + 26,
      textTop(er.y, er.h),
      '5–6',
      PALETTE.grey5,
    )
    this.extText.setDropShadow(1, 1, THEME.shadow, 1)

    // Hold Bay rack, bays, lamp.
    this.img(this.L.fixtures, RACK.x, RACK.y, 'holdbay_rack')
    for (let i = 0; i < 5; i++) {
      const r = bayRect(i)
      this.bays.push(this.img(this.L.fixtures, r.x, r.y, 'bay_pad'))
      const icon = this.img(this.L.badges, r.x + 14, r.y + 8, 'ic_lock')
      const text = this.text(this.L.badges, 0, r.y + 22, '', PALETTE.grey5)
      text.setDropShadow(1, 1, THEME.shadow, 1)
      this.bayLocks.push({ icon, text })
    }
    this.rackLamp = this.img(
      this.L.badges,
      RACK_LAMP.x,
      RACK_LAMP.y,
      'lamp_off',
    )
    this.sBadge = this.text(
      this.L.badges,
      RACK_S_BADGE.x,
      RACK_S_BADGE.y,
      'S',
      PALETTE.yellow2,
    )
    this.sBadge.setDropShadow(1, 1, THEME.shadow, 1)
    this.sBadge.setVisible(false)
    this.buildStation()

    // Quarantine Bin + counter.
    const binR = lay.rectFor('bin') as Rect
    this.bin = this.img(this.L.fixtures, binR.x, binR.y, 'bin_closed')
    this.binText = this.text(this.L.badges, 0, 0, '×0', THEME.textDark)

    // Shelf + mini grid + badge.
    const sh = lay.rectFor('shelf') as Rect
    this.shelfImg = this.img(this.L.fixtures, sh.x, sh.y, `shelf_t${t}`)
    for (let i = 0; i < SHELF_COLS * SHELF_ROWS; i++) {
      const c = shelfCell(i)
      const m = this.img(this.L.fixtures, c.x - 3, c.y - 3, 'parcel_mini_s')
      m.setVisible(false)
      this.minis.push(m)
    }
    this.badge = this.img(
      this.L.badges,
      SHELF_BADGE.x,
      SHELF_BADGE.y,
      'ui_badge',
    )
    this.badgeText = this.text(this.L.badges, 0, 0, '', THEME.textDark)

    // Tier props + the wanted poster.
    for (const p of PROPS_T1)
      this.props1.push(this.img(this.L.fixtures, p.x, p.y, 'props_t1'))
    for (const p of PROPS_T2)
      this.props2.push(this.img(this.L.fixtures, p.x, p.y, 'props_t2'))
    this.poster = this.img(
      this.L.fixtures,
      POSTER.x,
      POSTER.y,
      `wanted_poster_t${t}`,
    )
    // Tier-2 signage plates.
    for (const s of SIGNAGE) {
      const txt = addText(this.scene, PLATE_PAD / 2, 0, s.text, {
        tint: THEME.textDark,
      })
      const w = Math.round(txt.width) + PLATE_PAD
      const plate = addPanel(this.scene, 0, 0, w, PLATE_H, 'ui_tag')
      txt.setY(textTop(0, PLATE_H))
      const box = this.scene.add.container(s.x, s.y, [plate, txt])
      this.L.badges.add(box)
      this.plates.push(box)
    }
    this.applyTier(t, false)
  }

  private buildSlot(nodeId: string): SlotView {
    const lay = this.layout
    const r = lay.rectFor(nodeId) as Rect
    const empty = this.img(this.L.badges, r.x, r.y, 'slot_empty_outline')
    empty.setAlpha(EMPTY_OUTLINE_ALPHA)
    const locked = this.img(this.L.badges, r.x, r.y, 'slot_locked_outline')
    locked.setAlpha(LOCKED_ALPHA)
    const c = lay.plusAt(nodeId) ?? { x: r.x + 48, y: r.y + 40 }
    const lock = this.img(this.L.badges, r.x + 24, r.y + 16, 'ic_lock')
    const lockText = this.text(this.L.badges, 0, r.y + 34, '', PALETTE.grey5)
    lockText.setDropShadow(1, 1, THEME.shadow, 1)
    const plus = this.img(this.L.badges, c.x, c.y, 'ic_plus', 0.5, 0.5)
    const o = lay.outletAt(nodeId)
    const outlet = o ? this.img(this.L.belts, o.x, o.y, 'chute_outlet') : null
    const belts = this.beltImgs
      .filter((b) => b.tile.nodeId === nodeId)
      .map((b) => b.img)
    return {
      nodeId,
      rect: r,
      empty,
      locked,
      lock,
      lockText,
      plus,
      outlet,
      belts,
      machine: null,
      desk: null,
      fixtureKey: '',
      scanFrames: [],
      idleFrame: '',
      scanFps: MACHINE_SCAN_FPS,
      isLocked: false,
      lifted: false,
      unrollPending: false,
      unrollTimer: null,
    }
  }

  // ================================================================ station

  /** The Hold Bay station's parts (B2 §2.6), all hidden until syncStation. */
  private buildStation(): void {
    const r = HOLD_STATION
    // Podium: a back-layer prop (interior); absent until the art lands.
    const pod = frameOrNull('hold_station')
    if (pod) {
      this.stPodium = this.img(this.L.fixtures, r.x, r.y, pod)
      this.stPodium.setVisible(false)
    }
    // An atlas image (like the slots' outlines), never a Graphics: a
    // Graphics in the badges layer breaks its image batch (+1 draw call).
    this.stOutline = this.img(this.L.badges, r.x, r.y, 'station_outline')
    this.stOutline.setVisible(false)
    this.stLock = this.img(
      this.L.badges,
      r.x + r.w / 2,
      r.y + 8,
      'ic_lock',
      0.5,
    )
    this.stLock.setVisible(false)
    this.stLockText = this.text(this.L.badges, 0, r.y + 24, '', PALETTE.grey5)
    this.stLockText.setDropShadow(1, 1, THEME.shadow, 1)
    this.stLockText.setVisible(false)
    // The "+" marks the free stand (the podium's clear east half).
    this.stPlus = this.img(
      this.L.badges,
      SORTER_STAND.x,
      r.y + r.h / 2,
      'ic_plus',
      0.5,
      0.5,
    )
    this.stPlus.setVisible(false)
    // The Sorter Arm (L4; M6 rule): a 64 × 64 `fixture` (interior, a back
    // layer like the rack), drawn over the hidden podium; absent until its
    // frames are packed.
    const arm = frameOrNull('sorter_arm_f0')
    if (arm) {
      this.stArm = this.img(
        this.L.fixtures,
        SORTER_ARM_AT.x,
        SORTER_ARM_AT.y,
        arm,
      )
      this.stArm.setVisible(false)
    }
    this.stationKey = ''
  }

  /**
   * `parcel:tossed {source: 'arm'}`: the Arm reaches toward the rack (f1),
   * tosses toward the bin (f2) and rests (f0), ARM_FRAME_MS each; frames
   * the atlas lacks are skipped. A no-op without the Arm or its art.
   */
  onArmToss(): void {
    const img = this.stationArm()
    if (!img) return
    this.armTimer?.remove(false)
    const seq = ['sorter_arm_f1', 'sorter_arm_f2', 'sorter_arm_f0'].filter(
      (f) => frameOrNull(f) !== null,
    )
    const step = (i: number): void => {
      this.armTimer = null
      const f = seq[i]
      if (!f || !img.active) return
      img.setFrame(f)
      if (i + 1 < seq.length)
        this.armTimer = this.scene.time.delayedCall(ARM_FRAME_MS, () =>
          step(i + 1),
        )
    }
    step(0)
  }

  /** Re-read the station (every frame; cheap key compare). */
  private syncStation(): void {
    const look = stationLook(this.vs.holdStation, {
      podium: this.stPodium !== null,
      arm: this.stArm !== null,
    })
    const key = `${look.outline}|${look.lockText}|${look.podium}|${look.plus}|${look.arm}|${look.sBadge}`
    if (key === this.stationKey) return
    this.stationKey = key
    this.stOutline.setVisible(look.outline !== null)
    this.stOutline.setAlpha(
      look.outline === 'locked' ? LOCKED_ALPHA : EMPTY_OUTLINE_ALPHA,
    )
    const locked = look.lockText !== null
    this.stLock.setVisible(locked)
    this.stLockText.setVisible(locked)
    if (locked) {
      this.stLockText.setText(look.lockText ?? '')
      this.stLockText.setX(
        Math.round(
          HOLD_STATION.x + (HOLD_STATION.w - this.stLockText.width) / 2,
        ),
      )
    }
    this.stPodium?.setVisible(look.podium)
    this.stPlus.setVisible(look.plus)
    this.stArm?.setVisible(look.arm)
    this.sBadge.setVisible(look.sBadge)
  }

  /** The Sorter Arm's image while one sits in the station (pop / tests). */
  stationArm(): Img | null {
    return this.stArm?.visible ? this.stArm : null
  }

  // ================================================================ readout

  private buildReadout(): void {
    const y = -READOUT_GAP
    this.readoutPanel = addPanel(
      this.scene,
      0,
      y,
      ROOM_W,
      READOUT_H,
      'ui_panel_dark',
    )
    this.L.root.add(this.readoutPanel)
    this.readoutLead = addText(this.scene, 0, 0, '', { tint: THEME.textLight })
    this.readoutMid = addText(this.scene, 0, 0, '', { tint: THEME.textLight })
    this.readoutPct = addText(this.scene, 0, 0, '', { tint: THEME.ok })
    this.L.root.add([this.readoutLead, this.readoutMid, this.readoutPct])
    this.refreshReadout(true)
  }

  /** The strip's rect in room px (tap target padded by the scene). */
  readoutRect(): Rect {
    return { x: 0, y: -READOUT_GAP, w: ROOM_W, h: READOUT_H }
  }

  refreshReadout(force = false): void {
    const s = this.vs.laneStats()
    const noChecker = !this.vs.lane
      .nodes()
      .some(
        (n) =>
          n.kind === 'slot' && !n.locked && n.fixture && n.stations.length > 0,
      )
    const parts = readoutParts(s.ratePerMin, s.detectionPct, s.stalled)
    const key = `${parts.lead}|${parts.pct}|${noChecker}`
    if (!force && key === this.readoutKey) return
    this.readoutKey = key
    this.readoutLead.setText(parts.lead)
    this.readoutLead.setTint(parts.stalled ? THEME.danger : THEME.textLight)
    this.readoutMid.setText(parts.mid)
    this.readoutPct.setText(parts.pct)
    const tone = noChecker ? 'danger' : detectionTone(s.detectionPct)
    this.readoutPct.setTint(TONE_LIGHT[tone])
    const lw = Math.round(this.readoutLead.width)
    const mw = Math.round(this.readoutMid.width)
    const w = lw + mw + Math.round(this.readoutPct.width)
    const x = Math.round((ROOM_W - w) / 2)
    const ty = textTop(-READOUT_GAP, READOUT_H)
    this.readoutLead.setPosition(x, ty)
    this.readoutMid.setPosition(x + lw, ty)
    this.readoutPct.setPosition(x + lw + mw, ty)
  }

  // ================================================================ tiers

  /**
   * Tier switch hook (§5): t1 → t2 art. `fade` = the 400 ms cross-fade of a
   * level-up seen from inside (every tier-keyed frame under a fading copy of
   * its old look, the tier-only parts and the sign text faded); without it
   * the new tier shows at once (create, waking after the level-up).
   */
  applyTier(tier: 1 | 2, fade: boolean): void {
    const prev = this.tier
    this.tier = tier
    const cross = fade && prev !== tier
    const swap = (img: Img, frame: string): void => {
      const f = frameOrNull(frame)
      if (!f || img.frame.name === f) return
      if (cross) this.ghost(img)
      img.setFrame(f)
    }
    for (const f of this.floorImgs) swap(f.img, this.floorFrame(f.c, f.r))
    for (const w of this.wallImgs) swap(w, `wall_t${tier}`)
    for (const w of this.faceImgs) swap(w, `wallface_t${tier}`)
    swap(this.sign, `sign_t${tier}`)
    swap(this.shelfImg, `shelf_t${tier}`)
    swap(this.poster, `wanted_poster_t${tier}`)
    const tint = tier === 1 ? THEME.textLight : THEME.textDark
    if (cross && this.signText.tintTopLeft !== tint)
      this.ghostText(this.signText)
    this.signText.setTint(tint)
    this.fadeShown(this.bulb, tier === 1, cross)
    for (const s of this.strips) this.fadeShown(s, tier === 2, cross)
    for (const p of this.props1) this.fadeShown(p, tier === 1, cross)
    for (const p of this.props2) this.fadeShown(p, tier === 2, cross)
    for (const p of this.plates) this.fadeShown(p, tier === 2, cross)
    this.refreshSign()
  }

  /** Show / hide a tier-only part, over TIER_FADE_MS when `fade`. */
  private fadeShown(obj: Img | Box, show: boolean, fade: boolean): void {
    this.scene.tweens.killTweensOf(obj)
    if (!fade || obj.visible === show) {
      obj.setVisible(show)
      obj.setAlpha(1)
      return
    }
    obj.setVisible(true)
    obj.setAlpha(show ? 0 : 1)
    this.scene.tweens.add({
      targets: obj,
      alpha: show ? 1 : 0,
      duration: TIER_FADE_MS,
      onComplete: () => {
        obj.setVisible(show)
        obj.setAlpha(1)
      },
    })
  }

  /** A fading copy of a BitmapText's current look above it (sign text). */
  private ghostText(t: Txt): void {
    const parent = t.parentContainer
    if (!parent) return
    const g = addText(this.scene, t.x, t.y, t.text, { tint: t.tintTopLeft })
    if (g.font !== t.font) g.setFont(t.font) // the copy stays in t's batch
    parent.addAt(g, parent.getIndex(t) + 1)
    t.setAlpha(0)
    this.scene.tweens.add({ targets: t, alpha: 1, duration: TIER_FADE_MS })
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: TIER_FADE_MS,
      onComplete: () => g.destroy(),
    })
  }

  /** A fading copy of `img`'s current look above it (the cross-fade). */
  private ghost(img: Img): void {
    const parent = img.parentContainer
    if (!parent) return
    const g = this.scene.add
      .image(img.x, img.y, img.texture.key, img.frame.name)
      .setOrigin(img.originX, img.originY)
    parent.addAt(g, parent.getIndex(img) + 1)
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: TIER_FADE_MS,
      onComplete: () => g.destroy(),
    })
  }

  /**
   * level:up while inside (§5.3): the tier cross-fade, then (after it) the
   * unroll of every slot the level opened; bays and the shelf badge follow
   * the new caps.
   */
  onLevelUp(): void {
    const t = visualTier(this.gd, this.vs.level)
    const tierUp = t !== this.tier
    if (tierUp) this.applyTier(t, !this.instant)
    this.syncSlots(true, tierUp ? TIER_FADE_MS : 0)
    this.syncBays()
  }

  // ================================================================ sign

  refreshSign(): void {
    const n = this.vs.daysSinceIncident
    this.signText.setText(`DAYS SINCE LAST INCIDENT: ${n}`)
    this.signText.setPosition(
      Math.round(SIGN_TEXT.x + (SIGN_TEXT.w - this.signText.width) / 2),
      textTop(SIGN_TEXT.y, SIGN_TEXT.h),
    )
    const want = n === 0 && this.vs.lives < this.gd.economy.lives.start
    if (want === this.cracked) return
    this.cracked = want
    if (want) {
      this.crack.setAlpha(1).setVisible(true)
    } else {
      // "Replaced" (§1.11): the crack fades out over 200 ms.
      this.scene.tweens.add({
        targets: this.crack,
        alpha: 0,
        duration: SIGN_FADE_MS,
        onComplete: () => this.crack.setVisible(false),
      })
    }
  }

  /** life:lost: the 2-frame crack at 6 fps, then it stays (§1.11). */
  onLifeLost(): void {
    this.cracked = true
    this.crack.setAlpha(1).setVisible(true).setFrame('sign_crack_0')
    this.scene.time.delayedCall(1000 / CRACK_FPS, () => {
      if (this.crack.active) this.crack.setFrame('sign_crack_1')
    })
    this.refreshSign()
  }

  // ================================================================ slots

  /**
   * Re-read every slot's lock / fixture; with `unroll` a slot that just
   * went live unrolls (§1.6), `delay` ms from now.
   */
  syncSlots(unroll = false, delay = 0): void {
    for (const node of this.vs.lane.nodes()) {
      const v = this.slots.get(node.id)
      if (!v) continue
      const wasLocked = this.lockedSlots.has(node.id)
      const isLocked = node.locked !== undefined
      v.isLocked = isLocked
      if (isLocked) this.lockedSlots.add(node.id)
      else this.lockedSlots.delete(node.id)
      if (isLocked) this.cancelUnroll(v)
      this.syncFixture(v, node)
      if (unroll && wasLocked && !isLocked) this.unroll(v, node, delay)
      else this.syncSlotLook(v, node)
    }
    // Extension strip: slots past the belt column (§6).
    const extLocked = this.vs.lane
      .nodes()
      .some(
        (n) => n.kind === 'slot' && !this.layout.isBeltSlot(n.id) && n.locked,
      )
    this.ext.setVisible(extLocked)
    this.extLock.setVisible(extLocked)
    this.extText.setVisible(extLocked)
  }

  private syncSlotLook(v: SlotView, node: LaneNode): void {
    const hasFixture = node.fixture !== null && !v.lifted
    // An unlocked slot keeps its lock look until its unroll starts.
    const lockLook = v.isLocked || v.unrollPending
    v.locked.setVisible(lockLook)
    v.lock.setVisible(lockLook)
    v.lockText.setVisible(lockLook)
    if (v.isLocked) {
      v.lockText.setText(`Lv${node.locked?.level ?? ''}`)
      v.lockText.setX(Math.round(v.rect.x + 32 - v.lockText.width / 2))
    }
    v.empty.setVisible(!lockLook && !hasFixture)
    v.plus.setVisible(!lockLook && !hasFixture)
    for (const b of v.belts) {
      if (!this.scene.tweens.isTweening(b))
        b.setAlpha(lockLook ? LOCKED_BELT_ALPHA : 1)
    }
    v.outlet?.setAlpha(lockLook ? LOCKED_BELT_ALPHA : 1)
  }

  /** Belts of a locked (or not yet unrolled) slot stay on frame 0. */
  private beltFrozen(nodeId: string): boolean {
    return (
      this.lockedSlots.has(nodeId) ||
      this.slots.get(nodeId)?.unrollPending === true
    )
  }

  private fixtureKey(node: LaneNode): string {
    const f = node.fixture
    if (!f) return ''
    return f.kind === 'desk' ? 'desk' : `machine:${f.checker.defId}`
  }

  private syncFixture(v: SlotView, node: LaneNode): void {
    const key = this.fixtureKey(node)
    if (key === v.fixtureKey) return
    v.fixtureKey = key
    v.machine?.destroy()
    v.desk?.destroy()
    v.machine = null
    v.desk = null
    const f = node.fixture
    if (!f) return
    if (f.kind === 'desk') {
      const at = this.layout.deskAt(node.id)
      if (at) v.desk = this.img(this.L.machines, at.x, at.y, 'desk')
      return
    }
    const id = f.checker.defId
    const idle = frameOrNull(`${id}_f0`) ?? frameOrNull(`${id}_sil`)
    const scan = [`${id}_f1`, `${id}_f2`].filter((x) => frameOrNull(x))
    v.idleFrame = idle ?? 'metal_detector_f0'
    v.scanFrames = scan.length > 0 ? scan : [v.idleFrame]
    v.scanFps = scan.length > 1 ? SHAKER_SCAN_FPS : MACHINE_SCAN_FPS
    const at = this.layout.machineAt(node.id)
    if (at) v.machine = this.img(this.L.machines, at.x, at.y, v.idleFrame)
  }

  /**
   * §1.6 level-up unroll, `delay` ms from now (after the tier cross-fade):
   * the lock look fades out, the belt tiles fade in top to bottom 75 ms
   * apart, then the empty outline and its "+" fade in (≈ 300 ms in all).
   * The slot is live in the sim at once; until the unroll starts it keeps
   * the lock look and its belts stay still.
   */
  private unroll(v: SlotView, node: LaneNode, delay: number): void {
    this.cancelUnroll(v)
    v.unrollPending = true
    this.syncSlotLook(v, node)
    const start = (): void => {
      v.unrollTimer = null
      v.unrollPending = false
      if (!v.empty.scene) return
      const fresh = this.vs.lane.nodes().find((n) => n.id === v.nodeId)
      if (!fresh || fresh.locked) return
      const ghosts: [Img | Txt, number][] = [
        [v.locked, LOCKED_ALPHA],
        [v.lock, 1],
        [v.lockText, 1],
      ]
      this.syncSlotLook(v, fresh)
      for (const [o, rest] of ghosts) {
        o.setVisible(true).setAlpha(rest)
        this.scene.tweens.add({
          targets: o,
          alpha: 0,
          duration: UNLOCK_FADE_MS,
          onComplete: () => {
            o.setVisible(v.isLocked)
            o.setAlpha(rest)
          },
        })
      }
      v.belts.forEach((b, i) => {
        this.scene.tweens.killTweensOf(b)
        b.setAlpha(0)
        this.scene.tweens.add({
          targets: b,
          alpha: 1,
          delay: i * UNROLL_STEP_MS,
          duration: UNROLL_STEP_MS * 2,
        })
      })
      const after = v.belts.length * UNROLL_STEP_MS
      for (const [o, to] of [
        [v.empty, EMPTY_OUTLINE_ALPHA],
        [v.plus, 1],
      ] as const) {
        o.setAlpha(0)
        this.scene.tweens.add({
          targets: o,
          alpha: to,
          delay: after,
          duration: UNROLL_STEP_MS * 2,
        })
      }
    }
    if (delay > 0) v.unrollTimer = this.scene.time.delayedCall(delay, start)
    else start()
  }

  private cancelUnroll(v: SlotView): void {
    v.unrollTimer?.remove(false)
    v.unrollTimer = null
    v.unrollPending = false
  }

  /** Drop a running unroll and restore the resting alphas (syncAll). */
  private resetSlotTweens(v: SlotView): void {
    this.cancelUnroll(v)
    const rest: [Img | Txt, number][] = [
      [v.locked, LOCKED_ALPHA],
      [v.lock, 1],
      [v.lockText, 1],
      [v.empty, EMPTY_OUTLINE_ALPHA],
      [v.plus, 1],
    ]
    for (const [o, a] of rest) {
      this.scene.tweens.killTweensOf(o)
      o.setAlpha(a)
    }
    for (const b of v.belts) this.scene.tweens.killTweensOf(b)
  }

  /** §2.1: the fixture pops in (alpha 0 → 1, y + 8 → y, 150 ms). */
  onFixturePlaced(nodeId: string): void {
    this.syncSlots()
    this.syncStation()
    const v = this.slots.get(nodeId)
    // The Sorter Arm is bought into the Hold Bay node (`'hold'`, M6 §4.3).
    const arm = this.isHoldBay(nodeId) ? this.stationArm() : null
    const img = v?.machine ?? v?.desk ?? arm
    if (!img) return
    const y = img.y
    img.setAlpha(0).setY(y + 8)
    this.scene.tweens.add({
      targets: img,
      alpha: 1,
      y,
      duration: POP_MS,
      ease: 'Quad.easeOut',
      onUpdate: () => img.setY(Math.round(img.y)),
    })
  }

  /** The fixture image at a slot (drag ghost source), or null. */
  fixtureImage(nodeId: string): Img | null {
    const v = this.slots.get(nodeId)
    return v?.machine ?? v?.desk ?? null
  }

  /** Lift / drop a fixture for a drag: the source shows the empty look. */
  setLifted(nodeId: string | null): void {
    for (const v of this.slots.values()) {
      const lifted = v.nodeId === nodeId
      if (v.lifted === lifted) continue
      v.lifted = lifted
      v.machine?.setVisible(!lifted)
      v.desk?.setVisible(!lifted)
      const node = this.vs.lane.nodes().find((n) => n.id === v.nodeId)
      if (node) this.syncSlotLook(v, node)
    }
  }

  /** Blue outlines on every other live slot (drag / Move targets, §2.3). */
  showCandidates(fromNodeId: string | null): void {
    for (const g of this.candidates) g.destroy()
    this.candidates = []
    if (fromNodeId === null) return
    for (const v of this.slots.values()) {
      if (v.nodeId === fromNodeId || v.isLocked) continue
      this.candidates.push(this.fx.outline(v.rect, PALETTE.blue1))
    }
  }

  /** Pulse a slot outline (`colour`) for `ms` (pm:goto highlight). */
  pulseSlot(nodeId: string, colour: number, ms: number): void {
    const v = this.slots.get(nodeId)
    if (!v) return
    const g = this.fx.outline(v.rect, colour)
    this.pulses.push({ g, until: this.scene.time.now + ms })
  }

  /** Live slot ids drawn in the column, in node order. */
  liveSlotIds(): string[] {
    return this.vs.lane
      .nodes()
      .filter((n) => this.slots.has(n.id) && !n.locked)
      .map((n) => n.id)
  }

  // ================================================================ bays / bin / shelf

  private syncBays(): void {
    const cap = this.vs.holdBay.cap
    this.bays.forEach((b, i) => {
      b.setFrame(i < cap ? 'bay_pad' : 'bay_pad_locked')
      const lock = this.bayLocks[i]
      if (!lock) return
      const locked = i >= cap
      lock.icon.setVisible(locked)
      lock.text.setVisible(locked)
      if (locked) {
        const lv = this.gd.levels.find((l) => l.holdBayCap > i)?.level
        lock.text.setText(lv ? `Lv${lv}` : '')
        const r = bayRect(i)
        lock.text.setX(Math.round(r.x + (r.w - lock.text.width) / 2))
      }
    })
  }

  /** Level that opens Hold Bay bay i (0-based), or null. */
  bayUnlockLevel(i: number): number | null {
    return this.gd.levels.find((l) => l.holdBayCap > i)?.level ?? null
  }

  private refreshBin(): void {
    const n = this.vs.quarantine.count
    this.binText.setText(`×${n}`)
    this.binText.setPosition(
      Math.round(BIN_COUNTER.x - this.binText.width / 2),
      textTop(BIN_COUNTER.y - 8, 16),
    )
  }

  private lidOpen(shake: boolean): void {
    this.lidTimer?.remove(false)
    this.bin.setFrame('bin_open')
    const x = this.bin.x
    if (shake) {
      this.scene.tweens.add({
        targets: this.bin,
        x: x + 2,
        duration: 40,
        yoyo: true,
        repeat: 2,
        onComplete: () => this.bin.setX(x),
      })
    }
    this.lidTimer = this.scene.time.delayedCall(LID_MS, () => {
      if (this.bin.active) this.bin.setFrame('bin_closed')
      this.lidTimer = null
    })
  }

  /** Shelf minis (oldest first) + count badge; load flights for departures. */
  private syncShelf(): void {
    const ids = this.vs.shelf.ids
    const cap = this.vs.shelf.cap
    const cells = this.minis.length
    // Departures since the last frame: loaded parcels fly to the door (§1.4).
    if (!this.instant && this.prevShelf.length > 0) {
      const now = new Set(ids)
      this.prevShelf.forEach((id, i) => {
        if (now.has(id)) return
        const p = this.vs.parcel(id)
        if (p && p.state !== 'loaded' && p.state !== 'in_transit_out') return
        this.loadFlight(p?.size ?? 'S', i % cells)
      })
    }
    const before = this.instant ? null : new Set(this.prevShelf)
    this.prevShelf = ids.slice()
    for (let i = 0; i < cells; i++) {
      const m = this.minis[i] as Img
      const id = ids[i]
      const rec = id === undefined ? undefined : this.sprites.get(id)
      const p = id === undefined ? null : this.vs.parcel(id)
      if (id === undefined || !p || rec) {
        m.setVisible(false)
        continue
      }
      const f = miniFrame(p.size)
      if (m.frame.name !== f) m.setFrame(f)
      m.setVisible(true)
      // Arrived without a lane sprite (returned cargo of a sold vehicle,
      // §1.8, or a long advance): a 200 ms pop.
      if (before && !before.has(id)) this.popMini(m, shelfCell(i))
    }
    // Cleared parcels keep a check badge until loaded (§3.4).
    for (const [id, img] of this.miniChecks) {
      const i = ids.indexOf(id)
      if (i < 0 || i >= cells || this.sprites.has(id)) {
        img.destroy()
        this.miniChecks.delete(id)
      } else {
        const c = shelfCell(i)
        img.setPosition(c.x + CHECK_DX, c.y + CHECK_DY)
      }
    }
    for (const id of this.cleared) {
      const i = ids.indexOf(id)
      if (i < 0) {
        if (!this.sprites.has(id)) this.cleared.delete(id)
        continue
      }
      if (i >= cells || this.miniChecks.has(id) || this.sprites.has(id))
        continue
      const c = shelfCell(i)
      const img = this.img(
        this.L.badges,
        c.x + CHECK_DX,
        c.y + CHECK_DY,
        'ic_check',
      )
      this.miniChecks.set(id, img)
    }
    const full = ids.length >= cap
    this.badge.setTint(full ? PALETTE.red1 : PALETTE.grey5)
    this.badgeText.setText(
      full && ids.length === cap ? 'FULL' : `${ids.length}/${cap}`,
    )
    this.badgeText.setTint(full ? PALETTE.grey5 : THEME.textDark)
    this.badgeText.setPosition(
      Math.round(SHELF_BADGE.x + (SHELF_BADGE.w - this.badgeText.width) / 2),
      textTop(SHELF_BADGE.y, SHELF_BADGE.h),
    )
  }

  /** §1.8 pop: alpha 0 → 1 and 4 px drop into the cell over 200 ms. */
  private popMini(m: Img, cell: Point): void {
    const y = cell.y - 3
    this.scene.tweens.killTweensOf(m)
    m.setAlpha(0).setY(y - 4)
    this.scene.tweens.add({
      targets: m,
      alpha: 1,
      y,
      duration: SHELF_POP_MS,
      ease: 'Quad.easeOut',
      onUpdate: () => m.setY(Math.round(m.y)),
      onComplete: () => m.setAlpha(1).setY(y),
    })
  }

  private loadFlight(size: Size, cell: number): void {
    if (this.flights >= MAX_FLIGHTS) return
    const c = shelfCell(cell)
    const m = this.img(this.L.parcels, c.x - 3, c.y - 3, miniFrame(size))
    this.flights += 1
    moveAlong(this.scene, m, [{ x: DOOR_POINT.x - 8, y: DOOR_POINT.y - 8 }], {
      ms: LOAD_MS,
      onDone: () => {
        this.flights -= 1
        m.destroy()
      },
    })
  }

  // ================================================================ parcels

  private acquire(): Img | null {
    const img = this.pool.find((i) => !i.active) ?? null
    if (!img) {
      if (!this.poolWarned) console.warn('warehouse: parcel pool exhausted')
      this.poolWarned = true
      return null
    }
    img.setActive(true).setVisible(true).setAlpha(1)
    // Re-append so the newest parcel draws on top of older ones — but never
    // over a parcel mid-catch or flagged dark (the next parcel can reach the
    // station while the catch moment still plays on it).
    this.L.parcels.bringToTop(img)
    for (const rec of this.sprites.values())
      if (rec.alive && (rec.catching || rec.dark)) this.raise(rec)
    return img
  }

  /** Draw a parcel (with its ring, strain / check badge) above the others. */
  private raise(rec: PSprite): void {
    this.L.parcels.bringToTop(rec.img)
    if (rec.ring) this.L.parcels.bringToTop(rec.ring)
    if (rec.icon) this.L.parcels.bringToTop(rec.icon)
    if (rec.check) this.L.parcels.bringToTop(rec.check)
  }

  private spawn(id: number, at: Point, node: string | null): PSprite | null {
    const p = this.vs.parcel(id)
    if (!p) return null
    const img = this.acquire()
    if (!img) return null
    img.setFrame(parcelFrame(p.size)).setPosition(at.x, at.y)
    const rec: PSprite = {
      id,
      img,
      size: p.size,
      label: p.label,
      node,
      at: { ...at },
      bay: null,
      actions: [],
      running: false,
      tween: null,
      dark: false,
      strain: null,
      icon: null,
      check: null,
      ring: null,
      ringFrame: -1,
      leaving: null,
      catching: false,
      seen: true,
      alive: true,
    }
    this.sprites.set(id, rec)
    return rec
  }

  private release(rec: PSprite): void {
    rec.alive = false
    rec.catching = false
    rec.actions = []
    rec.tween?.stop()
    rec.tween = null
    rec.icon?.destroy()
    rec.check?.destroy()
    rec.ring?.destroy()
    rec.icon = rec.check = rec.ring = null
    rec.img.setVisible(false).setActive(false)
    if (this.sprites.get(rec.id) === rec) this.sprites.delete(rec.id)
  }

  private enqueue(rec: PSprite, a: Action): void {
    rec.actions.push(a)
    if (!rec.running) this.runNext(rec)
  }

  private runNext(rec: PSprite): void {
    if (!rec.alive) return
    const a = rec.actions.shift()
    if (!a) {
      rec.running = false
      return
    }
    rec.running = true
    let finished = false
    a(() => {
      if (finished) return
      finished = true
      rec.running = false
      this.runNext(rec)
    })
  }

  private moveAction(rec: PSprite, pts: Point[], opts: MoveOpts = {}): Action {
    return (done) => {
      rec.tween = moveAlong(this.scene, rec.img, pts, {
        ...opts,
        onStep: () => this.syncDeco(rec),
        onDone: () => {
          rec.tween = null
          done()
        },
      })
    }
  }

  /**
   * §3.3 divert slide from a slot into a Hold Bay bay along the slot's
   * `divert` edge: out to the chute (150 ms), down it (≤ 250 ms at 160 px/s),
   * into the bay (150 ms).
   */
  private divertAction(rec: PSprite, fromNode: string, bay: Point): Action {
    const pts = this.layout.pathBetween(fromNode, 'hold', bay, {
      x: rec.img.x,
      y: rec.img.y,
    })
    if (pts.length !== 3) return this.moveAction(rec, pts)
    const [out, down, into] = pts as [Point, Point, Point]
    const downMs = Math.min(
      DIVERT_DOWN_MAX_MS,
      Math.max(
        MOVE_MIN_MS / 2,
        (Math.abs(down.y - out.y) / PARCEL_PX_PER_S) * 1000,
      ),
    )
    const legs = [
      { to: out, ms: DIVERT_OUT_MS },
      { to: down, ms: Math.round(downMs) },
      { to: into, ms: DIVERT_IN_MS },
    ]
    return (done) => {
      moveLegs(this.scene, rec.img, legs, {
        onStep: () => this.syncDeco(rec),
        onTween: (t) => {
          rec.tween = t
        },
        onDone: done,
      })
    }
  }

  private waitAction(ms: number): Action {
    return (done) => {
      this.scene.time.delayedCall(ms, done)
    }
  }

  private setDark(rec: PSprite, dark: boolean, strain: Strain | null): void {
    rec.dark = dark
    rec.catching = false
    rec.strain = dark ? strain : null
    rec.img.setFrame(parcelFrame(rec.size, dark))
    if (dark && strain) {
      const f = frameOrNull(`ic_strain_${strain}`)
      if (f && !rec.icon) {
        rec.icon = this.scene.add.image(0, 0, atlasOf(f), f)
        this.L.parcels.add(rec.icon)
      } else if (f && rec.icon) rec.icon.setFrame(f)
    } else {
      rec.icon?.destroy()
      rec.icon = null
    }
    this.syncDeco(rec)
  }

  private setCheck(rec: PSprite, on: boolean): void {
    if (on && !rec.check) {
      rec.check = this.scene.add.image(0, 0, atlasOf('ic_check'), 'ic_check')
      this.L.parcels.add(rec.check)
    } else if (!on && rec.check) {
      rec.check.destroy()
      rec.check = null
    }
    this.syncDeco(rec)
  }

  /** Strain icon at (+8, −8), check badge, ring at the bay's bottom-left. */
  private syncDeco(rec: PSprite): void {
    const { x, y } = rec.img
    rec.icon?.setPosition(x + 8, y - 8)
    rec.check?.setPosition(x + 8, y - 8)
    if (rec.ring) {
      const r = bayRect(rec.bay ?? 0)
      rec.ring.setPosition(r.x + 4, r.y + 28)
    }
  }

  /**
   * The trait icon a flagged parcel wears — never a malware tell: a
   * specialised checker's own strain, none for a generalist (the
   * HoldBayCard rule, `shownTrait`).
   */
  private traitOf(p: Parcel | null): Strain | null {
    if (!p) return null
    const f = flaggerOf(this.vs.lane.nodes(), p.flaggedBy)
    return shownTrait(f?.checker ?? null)
  }

  /**
   * Desired anchor of every parcel inside the lane (not the shelf). Hold Bay
   * parcels take the sim's stable bay (holdBayPositions), never their index
   * in the queue, so a Toss leaves the other bays where they are.
   */
  private collectWants(): void {
    this.wants.clear()
    const lay = this.layout
    for (const node of this.vs.lane.nodes()) {
      if (!lay.has(node.id)) continue
      if (
        node.kind !== 'conveyor' &&
        node.kind !== 'slot' &&
        node.kind !== 'holdBay'
      )
        continue
      const a = lay.anchorsFor(node.id)
      const isHold = node.kind === 'holdBay'
      const bays = isHold
        ? holdBayPositions(node.queue, this.vs.holdBay.items)
        : null
      node.queue.forEach((id, i) => {
        const pos = bays?.get(id) ?? i
        const p = a.buffer[Math.min(pos, a.buffer.length - 1)]
        if (p)
          this.wants.set(id, {
            nodeId: node.id,
            point: p,
            bay: isHold ? pos : null,
          })
      })
      node.stations.forEach((st, j) => {
        if (st.parcelId === null) return
        const p = a.stations[Math.min(j, a.stations.length - 1)]
        if (p)
          this.wants.set(st.parcelId, { nodeId: node.id, point: p, bay: null })
      })
    }
  }

  /** Move every sprite toward the sim's state (see the file header). */
  reconcile(): void {
    this.collectWants()
    for (const rec of this.sprites.values()) rec.seen = false
    for (const [id, w] of this.wants) {
      let rec = this.sprites.get(id) ?? null
      if (!rec) {
        const fromDock = !this.instant && w.nodeId.startsWith('conv')
        rec = this.spawn(
          id,
          fromDock ? DOOR_POINT : w.point,
          fromDock ? 'dock1' : w.nodeId,
        )
        if (!rec) continue
        if (!fromDock) rec.at = { ...w.point }
      }
      rec.seen = true
      if (rec.leaving) continue
      if (w.bay !== null) rec.bay = w.bay
      if (rec.running) continue
      const p = this.vs.parcel(id)
      const dark = looksFlagged(p)
      if (dark !== rec.dark)
        this.setDark(rec, dark, dark ? this.traitOf(p) : null)
      if (rec.node !== w.nodeId) {
        const from = rec.node ?? w.nodeId
        const pts = this.layout.pathBetween(from, w.nodeId, w.point, {
          x: rec.img.x,
          y: rec.img.y,
        })
        const opts: MoveOpts = from === 'dock1' ? { ms: UNLOAD_MS } : {}
        rec.node = w.nodeId
        rec.at = { ...w.point }
        const divert = w.nodeId === 'hold' && this.isSlot(from)
        this.enqueue(
          rec,
          divert
            ? this.divertAction(rec, from, w.point)
            : this.moveAction(rec, pts, opts),
        )
      } else if (rec.at.x !== w.point.x || rec.at.y !== w.point.y) {
        rec.at = { ...w.point }
        this.enqueue(rec, this.moveAction(rec, [w.point]))
      }
    }
    for (const rec of this.sprites.values()) {
      if (!rec.seen && !rec.leaving) this.leave(rec)
    }
  }

  private isSlot(nodeId: string): boolean {
    return this.vs.lane
      .nodes()
      .some((n) => n.id === nodeId && n.kind === 'slot')
  }

  private isHoldBay(nodeId: string): boolean {
    return this.vs.lane
      .nodes()
      .some((n) => n.id === nodeId && n.kind === 'holdBay')
  }

  /** A sprite whose parcel left the lane: to the shelf, or gone. */
  private leave(rec: PSprite): void {
    const p = this.vs.parcel(rec.id)
    const ids = this.vs.shelf.ids
    const i = ids.indexOf(rec.id)
    if (p && p.state === 'on_shelf' && i >= 0 && !this.instant) {
      rec.leaving = 'shelf'
      const cell = this.layout.anchorsFor('shelf').buffer[i % this.minis.length]
      const dest = cell ?? this.layout.anchorsFor('shelf').entry
      const cleared = this.cleared.has(rec.id)
      this.enqueue(rec, (done) => {
        if (rec.dark) this.setDark(rec, false, null)
        if (cleared) this.setCheck(rec, true)
        rec.ring?.destroy()
        rec.ring = null
        done()
      })
      const from = rec.node ?? 'shelf'
      const pts = this.layout.pathBetween(from, 'shelf', dest, {
        x: rec.img.x,
        y: rec.img.y,
      })
      this.enqueue(rec, this.moveAction(rec, pts))
      this.enqueue(rec, (done) => {
        this.release(rec)
        done()
      })
      return
    }
    rec.leaving = 'gone'
    if (!rec.running) {
      this.release(rec)
      return
    }
    this.enqueue(rec, (done) => {
      this.release(rec)
      done()
    })
  }

  // ================================================================ events

  /**
   * §3.3 catch moment for `parcel:flagged {id, nodeId}`: sweep line over the
   * slot, 6-frame flip to the dark parcel + trait icon, then (t ≥ 260 ms)
   * the sprite follows state again (slide down the chute into its bay, or
   * stays dark in the slot when the Hold Bay is full). `onJump` fires at
   * 250 ms (workers jump, camera shake).
   */
  onFlagged(id: number, nodeId: string, onJump: () => void): void {
    const r = this.layout.rectFor(nodeId)
    const trait = this.traitOf(this.vs.parcel(id))
    let rec = this.sprites.get(id) ?? null
    if (!rec) {
      const st = this.layout.anchorsFor(nodeId).stations[0]
      rec = st ? this.spawn(id, st, nodeId) : null
    }
    if (r) this.fx.sweep(r)
    if (rec) {
      // The sim is ahead of the animation: the next parcel may already sit
      // on this station, so the catch draws above it — and stays above any
      // sprite acquired while it plays (acquire re-raises it).
      rec.catching = true
      this.raise(rec)
    }
    if (!rec) {
      this.scene.time.delayedCall(250, onJump)
      return
    }
    const target = rec
    this.enqueue(target, this.waitAction(FLIP_AT_MS))
    this.enqueue(target, (done) => {
      this.fx.flip(
        target.img,
        flipFrames(target.size),
        parcelFrame(target.size, true),
        () => {
          if (target.alive) this.setDark(target, true, trait)
          done()
        },
        () => target.alive,
      )
    })
    this.scene.time.delayedCall(250, onJump)
    this.enqueue(target, this.waitAction(SLIDE_AT_MS - FLIP_AT_MS - FLIP_MS))
  }

  /**
   * §3.4 Toss: bay → bin (250 ms), lid opens 300 ms, counter +1; malware =
   * gold DEFUSED +$N rising from the bin (+ CLOSE CALL! banner), clean =
   * grey OOPS — label was clean (two lines) and the lid shakes.
   */
  onTossed(info: TossInfo): void {
    let rec = this.sprites.get(info.id) ?? null
    if (!rec) {
      const bay = this.layout.anchorsFor('hold').buffer[0]
      rec = bay ? this.spawn(info.id, bay, 'hold') : null
      if (rec) this.setDark(rec, true, null)
    }
    const binR = this.layout.rectFor('bin') as Rect
    const outcome = (): void => {
      this.lidOpen(!info.wasMalware)
      this.refreshBin()
      const cx = binR.x + binR.w / 2
      if (info.wasMalware) {
        this.fx.stamp(`DEFUSED +$${info.bounty}`, cx, binR.y - 8, STAMP_GOLD)
        if (info.closeCall) this.fx.closeCall()
      } else {
        // Two lines (§3.4): "OOPS — <label>" / "was clean".
        this.fx.stamp(
          `OOPS — ${info.label}\nwas clean`,
          cx,
          binR.y - 22,
          STAMP_GREY,
          OOPS_LINES_MS,
          OOPS_RISE,
          true,
        )
      }
    }
    if (!rec) {
      outcome()
      return
    }
    rec.leaving = 'bin'
    const target = rec
    if (target.node !== 'hold') {
      const bays = this.layout.anchorsFor('hold').buffer
      const bi = Math.min(target.bay ?? this.vs.holdBay.count, bays.length - 1)
      const bay = bays[Math.max(0, bi)] as Point
      target.bay = Math.max(0, bi)
      const from = target.node ?? 'hold'
      target.node = 'hold'
      this.enqueue(
        target,
        this.isSlot(from)
          ? this.divertAction(target, from, bay)
          : this.moveAction(target, [bay]),
      )
    }
    this.enqueue(target, (done) => {
      target.ring?.destroy()
      target.ring = null
      done()
    })
    const mouth = this.layout.anchorsFor('bin').entry
    this.enqueue(target, this.moveAction(target, [mouth], { ms: TOSS_MS }))
    this.enqueue(target, (done) => {
      outcome()
      this.release(target)
      done()
    })
  }

  /** §3.4 Clear: remember it so the shelf mini carries the check badge. */
  onCleared(id: number): void {
    this.cleared.add(id)
  }

  // ================================================================ sync + frame

  /** Rebuild every dynamic part from sim state, without tweens (create / WAKE). */
  syncAll(): void {
    for (const rec of this.sprites.values()) this.release(rec)
    this.sprites.clear()
    for (const g of this.pulses) g.g.destroy()
    this.pulses = []
    this.showCandidates(null)
    this.setLifted(null)
    for (const img of this.miniChecks.values()) img.destroy()
    this.miniChecks.clear()
    this.cleared.clear()
    const holdId =
      this.vs.lane.nodes().find((n) => n.kind === 'holdBay')?.id ?? 'hold'
    for (const id of this.vs.shelf.ids) {
      const p = this.vs.parcel(id)
      if (p && wasCleared(p, holdId)) this.cleared.add(id)
    }
    const t = visualTier(this.gd, this.vs.level)
    if (t !== this.tier) this.applyTier(t, false)
    for (const v of this.slots.values()) this.resetSlotTweens(v)
    this.lockedSlots.clear()
    for (const n of this.vs.lane.nodes())
      if (n.locked) this.lockedSlots.add(n.id)
    this.syncSlots(false)
    this.syncBays()
    this.stationKey = ''
    this.armTimer?.remove(false)
    this.armTimer = null
    const rest = frameOrNull('sorter_arm_f0')
    if (rest) this.stArm?.setFrame(rest)
    this.syncStation()
    this.refreshBin()
    this.bin.setFrame('bin_closed')
    this.cracked = !this.cracked // force the sign state below
    this.refreshSign()
    this.prevShelf = []
    this.instant = true
    this.reconcile()
    this.syncShelf()
    this.instant = false
    // The outline is not an Fx-tracked effect (sleep's fx.clear() keeps it),
    // so a stall that ended while the room slept must drop it here, or the
    // next updateStall(null) sees '' === '' and the red box pulses forever.
    this.stallBox?.destroy()
    this.stallBox = null
    this.stallKey = ''
    this.refreshReadout(true)
  }

  update(_time: number, delta: number): void {
    this.reconcile()
    this.syncShelf()
    const stalled = this.vs.lane.stalled
    // Belts: 8 fps while the lane moves, frame 0 while stalled (§1.5, §4).
    if (stalled) {
      this.beltPhase = 0
    } else {
      this.beltPhase = (this.beltPhase + delta) % (4000 / BELT_FPS)
    }
    const bf = stalled ? 0 : Math.floor(this.beltPhase / (1000 / BELT_FPS)) % 4
    if (bf !== this.beltFrame || stalled) {
      this.beltFrame = bf
      for (const b of this.beltImgs) {
        const f = this.beltFrozen(b.tile.nodeId) ? 0 : bf
        if (f === b.frame) continue
        b.frame = f
        b.img.setFrame(`${b.tile.stem}_${f}`)
      }
    }
    this.animateMachines(delta)
    this.syncStation()
    this.updateStall(stalled)
    this.updateLamp(delta)
    this.updateRings(delta)
    this.updateBulb(delta)
    const now = this.scene.time.now
    this.pulses = this.pulses.filter((p) => {
      if (now >= p.until) {
        p.g.destroy()
        return false
      }
      p.g.setAlpha(
        Math.floor(now / STALL_PULSE_MS) % 2 === 0 ? 1 : PULSE_LOW_ALPHA,
      )
      return true
    })
  }

  private animateMachines(delta: number): void {
    this.machinePhase += delta
    for (const node of this.vs.lane.nodes()) {
      const v = this.slots.get(node.id)
      if (!v?.machine) continue
      const busy = node.stations.some((s) => s.parcelId !== null)
      let f = v.idleFrame
      if (busy && v.scanFrames.length > 0) {
        const k = Math.floor(this.machinePhase / (1000 / v.scanFps))
        f = v.scanFrames[k % v.scanFrames.length] ?? v.idleFrame
      }
      if (v.machine.frame.name !== f) v.machine.setFrame(f)
    }
  }

  /** The stalled node pulses a red outline at 1 Hz (§3.2, §4). */
  private updateStall(
    stalled: { reason: string; nodeId: string } | null,
  ): void {
    const key = stalled ? `${stalled.reason}:${stalled.nodeId}` : ''
    if (key !== this.stallKey) {
      this.stallKey = key
      this.stallBox?.destroy()
      this.stallBox = null
      const r = stalled ? this.layout.rectFor(stalled.nodeId) : null
      if (r) this.stallBox = this.fx.outline(r, PALETTE.red1)
      this.refreshReadout()
    }
    if (this.stallBox) {
      // 1 Hz pulse that never fully vanishes, so the jammed slot stays marked.
      const on = Math.floor(this.scene.time.now / STALL_PULSE_MS) % 2 === 0
      this.stallBox.setAlpha(on ? 1 : PULSE_LOW_ALPHA)
    }
  }

  /** Rack lamp: off / amber blink 1 Hz while held / red while full (§1.7). */
  private updateLamp(delta: number): void {
    this.blinkPhase = (this.blinkPhase + delta) % (2 * LAMP_BLINK_MS)
    const n = this.vs.holdBay.count
    const cap = this.vs.holdBay.cap
    let f = 'lamp_off'
    if (n >= cap && cap > 0) f = 'lamp_red'
    else if (n > 0)
      f = this.blinkPhase < LAMP_BLINK_MS ? 'lamp_amber' : 'lamp_off'
    if (this.rackLamp.frame.name !== f) this.rackLamp.setFrame(f)
  }

  /** Coin rings on resting Hold Bay parcels, refreshed every 500 ms (§1.7). */
  private updateRings(delta: number): void {
    this.ringAcc += delta
    if (this.ringAcc < RING_REFRESH_MS) return
    this.ringAcc = 0
    const tick = this.vs.tick
    for (const rec of this.sprites.values()) {
      const resting =
        rec.node === 'hold' && !rec.running && rec.leaving === null
      if (!resting) {
        rec.ring?.destroy()
        rec.ring = null
        continue
      }
      const p = this.vs.parcel(rec.id)
      if (!p) continue
      const age = (tick - p.spawnedTick) / 10
      const f = valueFactor(age, this.gd.parcels)
      const floor = this.gd.parcels.decay.floor
      const k = Math.round(((1 - f) / Math.max(0.01, 1 - floor)) * 8)
      const frame = Math.max(0, Math.min(8, k))
      if (!rec.ring) {
        const ring = `ring_${frame}`
        rec.ring = this.scene.add.image(0, 0, atlasOf(ring), ring)
        rec.ring.setOrigin(0, 0)
        this.L.parcels.add(rec.ring)
      } else if (rec.ringFrame !== frame) rec.ring.setFrame(`ring_${frame}`)
      rec.ringFrame = frame
      this.syncDeco(rec)
    }
  }

  private updateBulb(delta: number): void {
    if (this.tier !== 1) return
    this.bulbAcc += delta
    const t = this.bulbAcc % BULB_FLICKER_EVERY_MS
    const f = t < BULB_FLICKER_MS ? 'bulb_1' : 'bulb_0'
    if (this.bulb.frame.name !== f) this.bulb.setFrame(f)
  }

  /** Parcel currently drawn in a bay (for the Hold Bay tap), else null. */
  heldAt(bay: number): number | null {
    return this.vs.holdBay.items.find((it) => it.bay === bay)?.parcelId ?? null
  }

  /** Room-px centre of a parcel sprite, if one is on screen. */
  parcelPoint(id: number): Point | null {
    const rec = this.sprites.get(id)
    return rec ? { x: rec.img.x, y: rec.img.y } : null
  }

  /** Close transient visuals (game over, sleep). */
  clearTransient(): void {
    this.showCandidates(null)
    this.setLifted(null)
    for (const p of this.pulses) p.g.destroy()
    this.pulses = []
  }

  destroy(): void {
    for (const rec of this.sprites.values()) this.release(rec)
    for (const v of this.slots.values()) this.cancelUnroll(v)
    this.lidTimer?.remove(false)
    this.armTimer?.remove(false)
  }
}

/** Center x of the belt column (exported for the scene's drag ghost). */
export const BELT_CENTRE_X = BELT_CX
/** Text width helper for callers sizing plates (FONT_KEY kept in one place). */
export const ROOM_FONT = FONT_KEY
