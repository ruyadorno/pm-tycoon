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
// a sprite flying to the shelf hides its mini until it lands.
//
// No slot index is computed here: positions come from FixedLaneLayout by
// node id, order from `next` edges, caps and locks from the sim / data.
import Phaser from 'phaser'
import type { GameData } from '../../data/types.ts'
import type { LaneNode, Parcel, Size, Strain } from '../../sim/types.ts'
import type { ViewSim } from '../../sim/view-api.ts'
import { addPanel } from '../../ui/Panel.ts'
import { flaggerOf, shownTrait } from '../../ui/warehouse/HoldBayCard.ts'
import { detectionTone, TONE_LIGHT } from '../../ui/ShieldPopover.ts'
import { addText, textTop } from '../../ui/text.ts'
import { PALETTE, THEME } from '../../ui/theme.ts'
import { valueFactor } from '../decayPhase.ts'
import { FONT_KEY, WAREHOUSE_ATLAS } from '../atlases.ts'
import { frameOrNull } from '../frames.ts'
import {
  BELT_CX,
  BIN_COUNTER,
  BULB,
  bayRect,
  DOOR_POINT,
  FixedLaneLayout,
  POSTER,
  PROPS_T1,
  PROPS_T2,
  RACK,
  RACK_LAMP,
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
const TIER_FADE_MS = 400
const UNROLL_STEP_MS = 75
const POP_MS = 150
const UNLOAD_MS = 200
const TOSS_MS = 250
const LOAD_MS = 300
const SHELF_POP_MS = 200
const LID_MS = 300
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
        .image(0, 0, WAREHOUSE_ATLAS, 'parcel_s')
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
      .image(Math.round(x), Math.round(y), WAREHOUSE_ATLAS, f)
      .setOrigin(originX, originY)
    layer.add(i)
    return i
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
      const txt = addText(this.scene, 4, 0, s.text, { tint: THEME.textDark })
      const w = Math.round(txt.width) + 8
      const plate = addPanel(this.scene, 0, 0, w, 16, 'ui_tag')
      txt.setY(textTop(0, 16))
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
    }
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

  /** Tier switch hook (§5): t1 → t2 art; `fade` cross-fades 400 ms. */
  applyTier(tier: 1 | 2, fade: boolean): void {
    const prev = this.tier
    this.tier = tier
    const swap = (img: Img, frame: string): void => {
      const f = frameOrNull(frame)
      if (!f || img.frame.name === f) return
      if (fade && prev !== tier) this.ghost(img)
      img.setFrame(f)
    }
    for (const f of this.floorImgs) swap(f.img, this.floorFrame(f.c, f.r))
    for (const w of this.wallImgs) swap(w, `wall_t${tier}`)
    for (const w of this.faceImgs) swap(w, `wallface_t${tier}`)
    swap(this.sign, `sign_t${tier}`)
    swap(this.shelfImg, `shelf_t${tier}`)
    swap(this.poster, `wanted_poster_t${tier}`)
    this.signText.setTint(tier === 1 ? THEME.textLight : THEME.textDark)
    this.bulb.setVisible(tier === 1)
    for (const s of this.strips) s.setVisible(tier === 2)
    for (const p of this.props1) p.setVisible(tier === 1)
    for (const p of this.props2) p.setVisible(tier === 2)
    for (const p of this.plates) p.setVisible(tier === 2)
    this.refreshSign()
  }

  /** A fading copy of `img`'s current look above it (the cross-fade). */
  private ghost(img: Img): void {
    const parent = img.parentContainer
    if (!parent) return
    const g = this.scene.add
      .image(img.x, img.y, WAREHOUSE_ATLAS, img.frame.name)
      .setOrigin(img.originX, img.originY)
    parent.addAt(g, parent.getIndex(img) + 1)
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: TIER_FADE_MS,
      onComplete: () => g.destroy(),
    })
  }

  onLevelUp(): void {
    const t = visualTier(this.gd, this.vs.level)
    if (t !== this.tier) this.applyTier(t, true)
    this.syncSlots(true)
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

  /** Re-read every slot's lock / fixture (`unroll` animates new unlocks). */
  syncSlots(unroll = false): void {
    for (const node of this.vs.lane.nodes()) {
      const v = this.slots.get(node.id)
      if (!v) continue
      const wasLocked = this.lockedSlots.has(node.id)
      const isLocked = node.locked !== undefined
      v.isLocked = isLocked
      if (isLocked) this.lockedSlots.add(node.id)
      else this.lockedSlots.delete(node.id)
      this.syncFixture(v, node)
      this.syncSlotLook(v, node)
      if (unroll && wasLocked && !isLocked) this.unroll(v)
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
    v.locked.setVisible(v.isLocked)
    v.lock.setVisible(v.isLocked)
    v.lockText.setVisible(v.isLocked)
    if (v.isLocked) {
      v.lockText.setText(`Lv${node.locked?.level ?? ''}`)
      v.lockText.setX(Math.round(v.rect.x + 32 - v.lockText.width / 2))
    }
    v.empty.setVisible(!v.isLocked && !hasFixture)
    v.plus.setVisible(!v.isLocked && !hasFixture)
    for (const b of v.belts) {
      if (!this.scene.tweens.isTweening(b))
        b.setAlpha(v.isLocked ? LOCKED_BELT_ALPHA : 1)
    }
    v.outlet?.setAlpha(v.isLocked ? LOCKED_BELT_ALPHA : 1)
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

  /** §1.6 level-up unroll: belt tiles fade in top to bottom, 75 ms apart. */
  private unroll(v: SlotView): void {
    v.belts.forEach((b, i) => {
      b.setAlpha(0)
      this.scene.tweens.add({
        targets: b,
        alpha: 1,
        delay: i * UNROLL_STEP_MS,
        duration: UNROLL_STEP_MS * 2,
      })
    })
    v.empty.setAlpha(0)
    this.scene.tweens.add({
      targets: v.empty,
      alpha: EMPTY_OUTLINE_ALPHA,
      delay: v.belts.length * UNROLL_STEP_MS,
      duration: UNROLL_STEP_MS * 2,
    })
  }

  /** §2.1: the fixture pops in (alpha 0 → 1, y + 8 → y, 150 ms). */
  onFixturePlaced(nodeId: string): void {
    this.syncSlots()
    const v = this.slots.get(nodeId)
    const img = v?.machine ?? v?.desk
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
    // Re-append so the newest parcel draws on top of older ones.
    this.L.parcels.bringToTop(img)
    return img
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
      seen: true,
      alive: true,
    }
    this.sprites.set(id, rec)
    return rec
  }

  private release(rec: PSprite): void {
    rec.alive = false
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
    rec.strain = dark ? strain : null
    rec.img.setFrame(parcelFrame(rec.size, dark))
    if (dark && strain) {
      const f = frameOrNull(`ic_strain_${strain}`)
      if (f && !rec.icon) {
        rec.icon = this.scene.add.image(0, 0, WAREHOUSE_ATLAS, f)
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
      rec.check = this.scene.add.image(0, 0, WAREHOUSE_ATLAS, 'ic_check')
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

  /** Desired anchor of every parcel inside the lane (not the shelf). */
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
      node.queue.forEach((id, i) => {
        const p = a.buffer[Math.min(i, a.buffer.length - 1)]
        if (p)
          this.wants.set(id, {
            nodeId: node.id,
            point: p,
            bay: isHold ? i : null,
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
      // on this station, so the catch draws above it.
      this.L.parcels.bringToTop(rec.img)
      if (rec.icon) this.L.parcels.bringToTop(rec.icon)
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
    this.lockedSlots.clear()
    for (const n of this.vs.lane.nodes())
      if (n.locked) this.lockedSlots.add(n.id)
    this.syncSlots(false)
    this.syncBays()
    this.refreshBin()
    this.bin.setFrame('bin_closed')
    this.cracked = !this.cracked // force the sign state below
    this.refreshSign()
    this.prevShelf = []
    this.instant = true
    this.reconcile()
    this.syncShelf()
    this.instant = false
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
        const f = this.lockedSlots.has(b.tile.nodeId) ? 0 : bf
        if (f === b.frame) continue
        b.frame = f
        b.img.setFrame(`${b.tile.stem}_${f}`)
      }
    }
    this.animateMachines(delta)
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
        rec.ring = this.scene.add.image(0, 0, WAREHOUSE_ATLAS, `ring_${frame}`)
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
    this.lidTimer?.remove(false)
  }
}

/** Center x of the belt column (exported for the scene's drag ghost). */
export const BELT_CENTRE_X = BELT_CX
/** Text width helper for callers sizing plates (FONT_KEY kept in one place). */
export const ROOM_FONT = FONT_KEY
