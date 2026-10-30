// FixedLaneLayout (warehouse-view.md §1.2-§1.3, §1.13, §7.2, §8): the room's
// rect table as data. Pure — no Phaser, no DOM (tools/check-sim-purity.mjs),
// so tests/render/roomLayout.test.ts loads it under Node.
//
// Everything is in ROOM px (relative to the room container's top-left,
// 352 × 448 = 11 × 14 tiles of 32 px). The renderer never computes a
// position from a slot number: it asks this layout by LaneNode id (opaque
// strings from the sim), so iteration 2's GridLaneLayout can slot in behind
// the same LaneLayout interface (§8).
//
// Anchor conventions:
//   - `buffer[i]` = queue position i of the node, HEAD FIRST (the parcel
//     that leaves next): conveyor belt spots (head at the corner end, x 132;
//     §1.3 lists the same six x = 42 + 18i), a slot's input buffer
//     (buffer[0] = y_k + 22, buffer[1] = y_k + 6), Hold Bay bays (bay i),
//     shelf cells (oldest first, §6.8).
//   - `stations[j]` = processing spot of station j (slots only; a machine has
//     one, the desk up to three, stacked on the belt beside the desk).
//   - `entry` = where parcels appear / vanish (dock door, bin mouth).
// pathBetween(a, b, dest) returns the waypoints AFTER a's anchor up to and
// including `dest` (b's anchor; default b.entry / buffer[0]). It encodes the
// edge art: the conveyor corner, the belt column, the chute (each slot's
// `divert` edge) and the Clear path back to the shelf.
//
// M6 (spec-build2 §2.6, §4.4): the Hold Bay station is a fixed cell east of
// the rack (HOLD_STATION, not a lane node: `stationAt`, never `nodeAt`), the
// wanted poster and the tier props moved up the east column to make room,
// and the sorter walks in from the dock door along `stationWalkPath`.
//
// M8 (spec-build2 §4.1, §4.4; design-m8-m9 §6.1, R7, R13): docks 2–3 open
// their doors on the west wall 64 px apart (`dockGeom(k)`: door, tail, lamp,
// door point, hit) and their conveyors are 24 × 56 roller pads east of the
// door (`dock_pad`, six mini-parcel spots head first; the parcels hop onto
// conv1's line toward slot 1). The pads push the desk's west hit strip, the
// inspector's w1 stand point and the workers' aisle 8–12 px east on every
// tier. `new FixedLaneLayout(tier)`: tiers ≥ 3 use the 20 × 5 @ 11 px shelf
// grid (100 cells ≥ the L3–L5 caps 60 / 80 / 100), tiers 1–2 the 18 × 3 @ 12
// one; `propsFor(tier)` places the tier's props. The room keeps 14 rows
// through tier 3.
//
// M9 (spec-build2 §4.2-§4.4; design-m8-m9 §6.1, R2, R10, R22): room growth.
// Slots 5–6 unroll in the belt column below slot 4 at the same 64-px pitch
// (`BELT_SLOTS_BY_TIER` 4/4/4/5/6), so the room grows to `rowsForTier` 14 /
// 14 / 14 / 16 / 18 rows and everything at y ≥ 352 of the tier-1 table (the
// gap belt tile, the chute's foot, the shelf with its grid, badge and plate,
// the bin with its counter and plate, the Clear path, the ext strip) moves
// down by `shiftForTier` Δ = 64 × (beltSlots − 4). The Hold Bay rack, its
// station, the wanted poster, the props and the docks never move. The ext
// strip exists only while a lane slot lies past the belt column (`Slots
// 5–6` at tiers 1–3, `Slot 6` at tier 4, none at tier 5). `roomPlacement`
// takes the room height: a room that does not fit between the HUD bands
// keeps its readout strip fixed at the top of the band and scrolls
// vertically (integer, clamped to `maxScroll`); `scrollForDrag` /
// `scrollToShow` / `dragScrolls` are the pure halves of the scene's gesture.
// The exported constants keep their tier-1 values (ROOM_H, ROOM_ROWS,
// ROOM_BLOCK_H, CHUTE_BOTTOM, SHELF_BADGE, BIN_COUNTER, SIGNAGE).

export interface Point {
  x: number
  y: number
}

/** Same shape as src/ui/layout.ts Rect (half-open: x .. x + w − 1). */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface NodeAnchors {
  /** Queue positions, head first. */
  buffer: Point[]
  /** Processing stations (slots). */
  stations: Point[]
  /** Where a parcel enters or leaves the node from outside the lane. */
  entry: Point
  /** Slot only: the side outlet onto the chute. */
  outlet?: Point
}

export type BeltStem = 'belt_h' | 'belt_v' | 'belt_corner'

/** One 32 × 32 belt tile; `nodeId` = the node it belongs to (locks, stalls). */
export interface BeltTile {
  x: number
  y: number
  stem: BeltStem
  nodeId: string
}

/** Renderer-facing layout (warehouse-view.md §7.2 `LaneLayout`). */
export interface LaneLayout {
  readonly width: number
  readonly height: number
  /** True when the layout places this node id. */
  has(nodeId: string): boolean
  /** Visual rect of the node, or null for an unknown id. */
  rectFor(nodeId: string): Rect | null
  /** Tap rect (≥ 44 px where the node is tappable), or null. */
  hitFor(nodeId: string): Rect | null
  anchorsFor(nodeId: string): NodeAnchors
  /**
   * Waypoints after leaving `fromNodeId` (at `start`, default its arrival
   * point) up to and including `dest` (default `toNodeId`'s arrival point).
   */
  pathBetween(
    fromNodeId: string,
    toNodeId: string,
    dest?: Point,
    start?: Point,
  ): Point[]
  /** Display label: 'Slot 2', 'Hold Bay', 'Dock 1'. */
  labelFor(nodeId: string): string
  /** The node whose hit rect holds room point (x, y) (most specific first). */
  nodeAt(x: number, y: number): string | null
}

// ---- room geometry (room px) --------------------------------------------------

export const TILE = 32
export const ROOM_W = 352
export const ROOM_H = 448
export const ROOM_COLS = 11
export const ROOM_ROWS = 14
/** Readout strip: 352 × 20, glued 24 px above the room (§1.9). */
export const READOUT_H = 20
export const READOUT_GAP = 24
/** Height the room + strip need (roomY formula: 476 = 448 + 28). */
export const ROOM_BLOCK_H = ROOM_H + 28
/**
 * The strip's top margin (ROOM_BLOCK_H − ROOM_H − READOUT_GAP = 4 px): a room
 * block at most this much too tall for the bands still fits (roomPlacement).
 */
export const ROOM_SLACK = ROOM_BLOCK_H - ROOM_H - READOUT_GAP
/** Minimum viewport that fits without scrolling (§1.1). */
export const MIN_VIEW_W = 360
export const MIN_VIEW_H = 604

/** The lane's slot nodes (`slot1` … `slot6`, plan.md §5 node ids). */
export const SLOT_COUNT = 6
/** Slot pitch in the belt column (64 px, spec-build2 §4.4). */
export const SLOT_PITCH = 64
/** Warehouse tiers (levels.json warehouseTier 1..5). */
export const MAX_TIER = 5
/**
 * Slots drawn in the belt column per tier (index tier − 1, design-m8-m9
 * §6.1): slots past it share the dashed ext strip.
 */
export const BELT_SLOTS_BY_TIER = [4, 4, 4, 5, 6] as const

/** `tier` clamped to 1..MAX_TIER (integer). */
export function clampTier(tier: number): number {
  const t = Number.isFinite(tier) ? Math.floor(tier) : 1
  return Math.min(MAX_TIER, Math.max(1, t))
}

/** Belt-column slots of warehouse tier `tier` (4, 4, 4, 5, 6). */
export function beltSlotsForTier(tier: number): number {
  return BELT_SLOTS_BY_TIER[clampTier(tier) - 1] ?? 4
}

/**
 * How far everything below slot 4 moves at tier `tier`: Δ = 64 ×
 * (beltSlots − 4) = 0, 0, 0, 64, 128 (design-m8-m9 §6.1).
 */
export function shiftForTier(tier: number): number {
  return SLOT_PITCH * (beltSlotsForTier(tier) - 4)
}

/**
 * Room rows of tier `tier`: 14 / 14 / 14 / 16 / 18 (design-m8-m9 R2: slot 6
 * ends at y 480, + the 32-px belt gap + the 64-px shelf = 576 = 18 rows; B2
 * §4.4's "16 / 16" holds only five belt slots at the 64-px pitch).
 */
export function rowsForTier(tier: number): number {
  return ROOM_ROWS + shiftForTier(tier) / TILE
}

/** Room height in px of tier `tier` (rows × 32: 448, 512, 576). */
export function roomHeightForTier(tier: number): number {
  return rowsForTier(tier) * TILE
}

/** Height the room + readout strip need at tier `tier` (rows × 32 + 28: 476 / 540 / 604). */
export function roomBlockH(tier: number): number {
  return roomHeightForTier(tier) + (ROOM_BLOCK_H - ROOM_H)
}

/** The belt column c4 (x 128–159) and its centre line. */
export const BELT_X = 128
export const BELT_CX = 144
/** The chute rail x (16 px at x 172) and its centre line. */
export const CHUTE_X = 172
export const CHUTE_CX = 180
export const CHUTE_TOP = 96
export const CHUTE_BOTTOM = 352
/** Hold Bay rack and its five 44 × 44 bay pads. */
export const RACK = { x: 192, y: 96, w: 64, h: 256 } as const
export const BAY_COUNT = 5
export const BAY_PITCH = 48
export const RACK_LAMP = { x: 244, y: 100 } as const
/** Shelf mini-parcel grid (§1.8): 18 × 3 cells, 12 px pitch, 10 × 10 minis. */
export const SHELF_COLS = 18
export const SHELF_ROWS = 3
export const SHELF_PITCH = 12
export const SHELF_ORIGIN = { x: 38, y: 390 } as const

/** A shelf mini grid: `cols × rows` 10 × 10 minis at `pitch` from `origin` (top-left of mini 0). */
export interface ShelfGrid {
  cols: number
  rows: number
  pitch: number
  origin: Point
}

/** Tiers 1–2 (§1.8): 18 × 3 @ 12 px from (38, 390) — 54 cells. */
export const SHELF_GRID_T1: ShelfGrid = {
  cols: SHELF_COLS,
  rows: SHELF_ROWS,
  pitch: SHELF_PITCH,
  origin: { ...SHELF_ORIGIN },
}

/**
 * Tiers ≥ 3 (design-m8-m9 §6.1, R13): 20 × 5 @ 11 px from (35, 388) — 100
 * cells, the L3–L5 caps 60 / 80 / 100; `shelf_t3+` draws its five wire-deck
 * rows under exactly these cells (minis at canvas (3 + 11c, 4 + 11r)).
 */
export const SHELF_GRID_T3: ShelfGrid = {
  cols: 20,
  rows: 5,
  pitch: 11,
  origin: { x: 35, y: 388 },
}

/** The most cells any tier's grid has (the renderer's mini pool). */
export const SHELF_MAX_CELLS = SHELF_GRID_T3.cols * SHELF_GRID_T3.rows

/** The shelf grid of warehouse tier `tier`. */
export function shelfGrid(tier: number): ShelfGrid {
  return tier >= 3 ? SHELF_GRID_T3 : SHELF_GRID_T1
}

/** Cell i (oldest first, wrapping past the last cell) of `g`: top-left of its 10 × 10 mini. */
export function shelfCellIn(g: ShelfGrid, i: number): Point {
  const c = i % g.cols
  const r = Math.floor(i / g.cols) % g.rows
  return { x: g.origin.x + c * g.pitch, y: g.origin.y + r * g.pitch }
}
export const SHELF_BADGE = { x: 212, y: 372, w: 40, h: 16 } as const
/** Quarantine-bin counter centre (bin plate, artUi hand-off). */
export const BIN_COUNTER = { x: 288, y: 436 } as const
/** Dock: door on the west wall, the tail through it, the lamp above. */
export const DOOR = { x: 0, y: 36, w: 32, h: 56 } as const
export const TAIL = { x: 0, y: 44, w: 40, h: 40 } as const
export const TAIL_HIDDEN_X = -48
export const DOCK_LAMP = { x: 12, y: 24 } as const
export const DOOR_POINT: Point = { x: 20, y: 64 }
/** Dock status panel (§1.4). */
export const DOCK_PANEL = { x: 160, y: 36, w: 156, h: 52 } as const
/** Locked docks 2–3 (§1.4, §6), in economy.json `docks[]` order. */
export const LOCKED_DOORS: readonly Rect[] = [
  { x: 0, y: 100, w: 32, h: 56 },
  { x: 0, y: 164, w: 32, h: 56 },
]
/** Loading docks on the west wall (dock 1 + economy.json docks 2–3). */
export const DOCK_COUNT = 3
/** Dock k's parts are dock 1's moved down DOCK_PITCH × (k − 1). */
export const DOCK_PITCH = 64
/**
 * The roller pad of docks 2–3 (interior-prop `dock_pad`, 24 × 56) east of
 * the door, door.y to door.y + 55 (design-m8-m9 §6.1, R7): the conveyor
 * `conv2` / `conv3` of the sim, drawn as a pad because a belt from doors 2–3
 * would cross the desk strip.
 */
export const DOCK_PAD = { x: 32, w: 24, h: 56 } as const
/**
 * The pad's six mini-parcel spots (centres, head first: the north pair
 * leaves next), relative to the pad's top-left.
 */
export const PAD_SPOTS: readonly Point[] = [
  { x: 7, y: 11 },
  { x: 18, y: 11 },
  { x: 7, y: 27 },
  { x: 18, y: 27 },
  { x: 7, y: 43 },
  { x: 18, y: 43 },
]
/** Where a pad parcel joins conv1's line on its way to slot 1. */
export const PAD_EXIT: Point = { x: 44, y: 64 }

/** One loading dock's room parts (design-m8-m9 §6.1 table). */
export interface DockGeom {
  /** 1..3 (the dock number, `dock<index>`). */
  index: number
  door: Rect
  /** The docked vehicle's tail (40 × 40) at rest. */
  tail: Rect
  /** The wall lamp (8 × 8) top-left. */
  lamp: Point
  /** Where unloaded parcels and walking workers come through the door. */
  doorPoint: Point
  /** Docks 2–3: the conveyor's roller pad; dock 1 feeds the belt (null). */
  pad: Rect | null
  /** Tap rect: dock 1 the belt area west of the column; docks 2–3 door + pad (56 × 56). */
  hit: Rect
}

/** Dock number of `dock3` / `conv3` (any id ending in its number), else NaN. */
export function dockIndexOf(id: string): number {
  const m = /^(?:dock|conv)([1-9]\d*)$/.exec(id)
  return m ? Number(m[1]) : Number.NaN
}

/** The parts of loading dock `index` (1..DOCK_COUNT), else null. */
export function dockGeom(index: number): DockGeom | null {
  if (!Number.isInteger(index) || index < 1 || index > DOCK_COUNT) return null
  const dy = DOCK_PITCH * (index - 1)
  const door: Rect = { ...DOOR, y: DOOR.y + dy }
  const first = index === 1
  return {
    index,
    door,
    tail: { ...TAIL, y: TAIL.y + dy },
    lamp: first ? { ...DOCK_LAMP } : { x: DOCK_LAMP.x, y: door.y - 8 },
    doorPoint: { x: DOOR_POINT.x, y: DOOR_POINT.y + dy },
    pad: first ? null : { x: DOCK_PAD.x, y: door.y, w: DOCK_PAD.w, h: door.h },
    hit: first
      ? { x: 0, y: 32, w: 128, h: 64 }
      : { x: 0, y: door.y, w: DOCK_PAD.x + DOCK_PAD.w, h: door.h },
  }
}
/** North-wall sign and its BitmapText face (artUi: x 8..191, y 4..19). */
export const SIGN = { x: 76, y: 4, w: 200, h: 24 } as const
export const SIGN_TEXT = { x: 84, y: 8, w: 184, h: 16 } as const
export const BULB = { x: 296, y: 6 } as const
export const STRIP_LIGHTS: readonly Point[] = [
  { x: 8, y: 2 },
  { x: 280, y: 2 },
]
/**
 * The east column (x 256–319) between the rack and the east wall, top to
 * bottom (spec-build2 §4.4, applied at M6 because the station is M6): the
 * wanted poster (y 120), the tier props (y 164–283), the Hold Bay station
 * (y 300–347, east of the rack, above the bin). Tier props (§5.1 / §5.2):
 * two 48 × 48 cardboard piles at tier 1, one 48 × 64 shelving unit at tier 2,
 * both clear of the poster's hit and the station's cell.
 */
export const PROPS_T1: readonly Point[] = [
  { x: 264, y: 164 },
  { x: 264, y: 236 },
]
export const PROPS_T2: readonly Point[] = [{ x: 264, y: 196 }]
/**
 * Tier 3 (M8): one 48 × 64 shrink-wrapped pallet + pallet jack where the
 * tier-2 shelving unit stood (tiers 4–5 reuse the spot; their art falls back
 * to the nearest lower tier until M9 draws it).
 */
export const PROPS_T3: readonly Point[] = [{ x: 264, y: 196 }]
/** Prop canvases (art/manifest.json `props_t1` / `props_t2` / `props_t3`). */
export const PROP_T1_SIZE = { w: 48, h: 48 } as const
export const PROP_T2_SIZE = { w: 48, h: 64 } as const
export const PROP_T3_SIZE = { w: 48, h: 64 } as const

/** Which tier's prop set a room of tier `tier` shows (1, 2, or 3 for tiers ≥ 3). */
export function propGroup(tier: number): 1 | 2 | 3 {
  return tier >= 3 ? 3 : tier >= 2 ? 2 : 1
}

/** Top-left of every prop of tier `tier` (`props_t<tier>` art, per propGroup). */
export function propsFor(tier: number): readonly Point[] {
  const g = propGroup(tier)
  return g === 1 ? PROPS_T1 : g === 2 ? PROPS_T2 : PROPS_T3
}
/** The wanted poster (32 × 32) and its tap rect padded to 44 (B2 §4.4). */
export const POSTER = { x: 272, y: 120, w: 32, h: 32 } as const
export const POSTER_HIT = { x: 266, y: 114, w: 44, h: 44 } as const
/**
 * The Hold Bay station (B2 §2.6, §4.4): one 48 × 48 cell east of the rack,
 * above the Quarantine Bin; the `hold_station` podium (interior back layer)
 * fills it, the seated sorter (or the Sorter Arm) stands in it. The tap rect
 * is the cell itself (48 ≥ 44).
 */
export const HOLD_STATION = { x: 264, y: 300, w: 48, h: 48 } as const
export const HOLD_STATION_HIT = { x: 264, y: 300, w: 48, h: 48 } as const
/**
 * The sorter's feet: the station's east half (sprite x 284–307), facing
 * west toward the rack — the podium art keeps its clipboard in the west half.
 */
export const SORTER_STAND: Point = { x: 296, y: 340 }
export const SORTER_FACING = 'w' as const
/**
 * The Sorter Arm (L4, M6 rule) in the same station: its 64 × 64 `fixture`
 * canvas (art/manifest.json `sorter_arm`) bottom-centred on the cell — x
 * 256–319 between the rack and the east wall, y 284–347 under the props.
 */
export const SORTER_ARM_SIZE = { w: 64, h: 64 } as const
export const SORTER_ARM_AT: Point = {
  x: HOLD_STATION.x + HOLD_STATION.w / 2 - SORTER_ARM_SIZE.w / 2,
  y: HOLD_STATION.y + HOLD_STATION.h - SORTER_ARM_SIZE.h,
}
/**
 * The row the sorter crosses the room on (feet y): just south of the rack,
 * the chute and the station, north of the slots-5–6 strip and the shelf —
 * the walker's 24 × 32 sprite (y 324–355) never passes under a plate.
 */
export const STATION_ROW_Y = 352
/**
 * The aisle west of the desks the workers walk (feet x). M8 (design-m8-m9
 * R7): 68 (was 56), so a walker's 24-px sprite (x 56–79) clears the dock 2–3
 * roller pads (x 32–55) and the desk sprite (x 80–127).
 */
export const AISLE_X = 68
/** The desk's west hit strip starts here (M8: 56, east of the dock pads; was 48). */
export const DESK_HIT_X = 56
/** Inspector w1's feet x (M8: 68 on the aisle, was 60; sprite x 56–79). */
export const W1_X = 68
/** The rack lamp's `S` badge (m5x7 text top-left: cap y 110–116, x 245–249). */
export const RACK_S_BADGE = { x: 245, y: 106 } as const
/**
 * Tier-2 signage plates (§5.2): text + top-left; each plate is the m5x7 text
 * width + 8 px wide and 16 px tall (`ui_tag`). SHELF sits at x 32 (§5.2
 * says 36): its 38-px plate must end west of the ext strip at x 72.
 */
export const SIGNAGE: readonly { text: string; x: number; y: number }[] = [
  { text: 'INTAKE', x: 40, y: 34 },
  { text: 'HOLD', x: 200, y: 80 },
  { text: 'SHELF', x: 32, y: 370 },
  { text: 'QUARANTINE', x: 252, y: 368 },
]
/** Signage plate height and the padding around its text (§5.2). */
export const PLATE_H = 16
export const PLATE_PAD = 8
/** CLOSE CALL! banner spot (§3.4). */
export const BANNER = { x: 16, y: 40, w: 320, h: 32 } as const

const slotY = (k: number): number => 96 + 64 * (k - 1)

interface NodeDef {
  label: string
  rect: Rect
  hit: Rect | null
  anchors: NodeAnchors
}

function slotDef(k: number): NodeDef {
  const y = slotY(k)
  return {
    label: `Slot ${k}`,
    rect: { x: 96, y, w: 64, h: 64 },
    hit: { x: 96, y, w: 80, h: 64 },
    anchors: {
      buffer: [
        { x: BELT_CX, y: y + 22 },
        { x: BELT_CX, y: y + 6 },
      ],
      stations: [
        { x: BELT_CX, y: y + 40 },
        { x: BELT_CX, y: y + 50 },
        { x: BELT_CX, y: y + 30 },
      ],
      entry: { x: BELT_CX, y },
      outlet: { x: 166, y: y + 40 },
    },
  }
}

/**
 * The one-dashed-outline extension strip for the slots past the belt column
 * (§1.3 `ext`; tier-1 rects, moved down by Δ at tier 4).
 */
const EXT_RECT: Rect = { x: 72, y: 356, w: 56, h: 24 }
const EXT_HIT: Rect = { x: 72, y: 352, w: 56, h: 32 }

function extDef(k: number, dy: number): NodeDef {
  const y = 368 + dy
  return {
    label: `Slot ${k}`,
    rect: { ...EXT_RECT, y: EXT_RECT.y + dy },
    hit: { ...EXT_HIT, y: EXT_HIT.y + dy },
    anchors: {
      buffer: [{ x: BELT_CX, y }],
      stations: [{ x: BELT_CX, y }],
      entry: { x: BELT_CX, y },
    },
  }
}

/** Shelf cell i (oldest first) of the tier-1/2 grid: top-left of its 10 × 10 mini. */
export function shelfCell(i: number): Point {
  return shelfCellIn(SHELF_GRID_T1, i)
}

/** Top-left of bay i's pad (44 × 44). */
export function bayRect(i: number): Rect {
  return { x: 196, y: 100 + BAY_PITCH * i, w: 44, h: 44 }
}

/** Dock k ≥ 2 (M8): the door + pad node and its pad conveyor (design-m8-m9 §6.1). */
function addDockDefs(t: Map<string, NodeDef>, k: number): void {
  const g = dockGeom(k)
  if (!g?.pad) return
  const pad = g.pad
  t.set(`dock${k}`, {
    label: `Dock ${k}`,
    rect: { ...g.hit },
    hit: { ...g.hit },
    anchors: { buffer: [], stations: [], entry: { ...g.doorPoint } },
  })
  t.set(`conv${k}`, {
    label: `Conveyor ${k}`,
    rect: { ...pad },
    hit: null,
    anchors: {
      buffer: PAD_SPOTS.map((p) => ({ x: pad.x + p.x, y: pad.y + p.y })),
      stations: [],
      entry: { x: pad.x + pad.w / 2, y: pad.y + pad.h / 2 },
    },
  })
}

function buildTable(tier: number, grid: ShelfGrid): Map<string, NodeDef> {
  const t = new Map<string, NodeDef>()
  const belt = beltSlotsForTier(tier)
  const dy = shiftForTier(tier)
  t.set('dock1', {
    label: 'Dock 1',
    rect: { x: 0, y: 32, w: 160, h: 64 },
    hit: { x: 0, y: 32, w: 128, h: 64 },
    anchors: {
      buffer: [],
      stations: [],
      entry: { ...DOOR_POINT },
    },
  })
  t.set('conv1', {
    label: 'Conveyor',
    rect: { x: 32, y: 48, w: 128, h: 32 },
    hit: null,
    anchors: {
      buffer: Array.from({ length: 6 }, (_, q) => ({ x: 132 - 18 * q, y: 64 })),
      stations: [],
      entry: { x: 42, y: 64 },
    },
  })
  for (let k = 2; k <= DOCK_COUNT; k++) addDockDefs(t, k)
  for (let k = 1; k <= SLOT_COUNT; k++)
    t.set(`slot${k}`, k <= belt ? slotDef(k) : extDef(k, dy))
  t.set('hold', {
    label: 'Hold Bay',
    rect: { ...RACK },
    hit: { x: 196, y: 100, w: 44, h: BAY_PITCH * (BAY_COUNT - 1) + 44 },
    anchors: {
      buffer: Array.from({ length: BAY_COUNT }, (_, i) => ({
        x: 218,
        y: 122 + BAY_PITCH * i,
      })),
      stations: [],
      entry: { x: CHUTE_CX, y: 122 },
    },
  })
  t.set('bin', {
    label: 'Quarantine Bin',
    rect: { x: 256, y: 384 + dy, w: 64, h: 64 },
    hit: { x: 256, y: 384 + dy, w: 64, h: 64 },
    anchors: { buffer: [], stations: [], entry: { x: 288, y: 404 + dy } },
  })
  t.set('shelf', {
    label: 'Shelf',
    rect: { x: 32, y: 384 + dy, w: 224, h: 64 },
    hit: { x: 32, y: 384 + dy, w: 224, h: 64 },
    anchors: {
      buffer: Array.from({ length: grid.cols * grid.rows }, (_, i) => {
        const c = shelfCellIn(grid, i)
        return { x: c.x + 5, y: c.y + 5 }
      }),
      stations: [],
      entry: { x: BELT_CX, y: 388 + dy },
    },
  })
  return t
}

const containsPt = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h

/**
 * The fixed lane (spec §6.1-§6.2): docks 1–3 (dock 1's belt, docks 2–3's
 * pads), the belt-column slots (1–4, 1–5 at tier 4, 1–6 at tier 5), the
 * rest as the dashed extension strip, the Hold Bay rack, the Quarantine Bin
 * and the shelf. `tier` (the levels.json warehouseTier, default 1; clamped
 * to 1..5) picks the shelf grid, the props and — M9 — the room's rows.
 */
export class FixedLaneLayout implements LaneLayout {
  readonly width = ROOM_W
  /** rows × 32: 448 at tiers 1–3, 512 at tier 4, 576 at tier 5. */
  readonly height: number
  readonly tier: number
  /** Room rows (rowsForTier): 14, 16, 18. */
  readonly rows: number
  /** Slots drawn in the belt column (BELT_SLOTS_BY_TIER). */
  readonly beltSlots: number
  /** How far everything below slot 4 moved (shiftForTier: 0, 64, 128). */
  readonly shift: number
  private readonly grid: ShelfGrid
  private readonly table: Map<string, NodeDef>

  constructor(tier = 1) {
    this.tier = clampTier(tier)
    this.rows = rowsForTier(this.tier)
    this.height = this.rows * TILE
    this.beltSlots = beltSlotsForTier(this.tier)
    this.shift = shiftForTier(this.tier)
    const g = shelfGrid(this.tier)
    this.grid = { ...g, origin: { x: g.origin.x, y: g.origin.y + this.shift } }
    this.table = buildTable(this.tier, this.grid)
  }

  /** Loading dock `dockId`'s parts (`dock2`, or its conveyor `conv2`), else null. */
  dockGeom(dockId: string): DockGeom | null {
    return dockGeom(dockIndexOf(dockId))
  }

  /** True for a dock 2–3 conveyor (a roller pad: mini parcels, PAD_EXIT path). */
  isPad(nodeId: string): boolean {
    return (
      /^conv\d+$/.test(nodeId) && (this.dockGeom(nodeId)?.pad ?? null) !== null
    )
  }

  /** This tier's shelf grid. */
  shelfGrid(): ShelfGrid {
    return this.grid
  }

  /** Shelf cell i (oldest first) of this tier's grid: top-left of its 10 × 10 mini. */
  shelfCell(i: number): Point {
    return shelfCellIn(this.grid, i)
  }

  /** How many minis this tier's shelf grid draws (54, or 100 from tier 3). */
  shelfCapacity(): number {
    return this.grid.cols * this.grid.rows
  }

  /** Top-left of this tier's props (propsFor). */
  props(): readonly Point[] {
    return propsFor(this.tier)
  }

  /** Top-left of tier `tier`'s props (design-m8-m9 §6.1 API; the props never move with Δ). */
  propsFor(tier: number): readonly Point[] {
    return propsFor(tier)
  }

  /** The Quarantine Bin (64 × 64, Δ below the tier-1 spot). */
  binRect(): Rect {
    return this.rectFor('bin') as Rect
  }

  /** Centre of the bin counter (`×N`). */
  binCounter(): Point {
    return { x: BIN_COUNTER.x, y: BIN_COUNTER.y + this.shift }
  }

  /** The shelf's count badge (`57/60`). */
  shelfBadge(): Rect {
    return { ...SHELF_BADGE, y: SHELF_BADGE.y + this.shift }
  }

  /** The tier-2+ signage plates: INTAKE / HOLD stay, SHELF / QUARANTINE follow the shelf and the bin. */
  plates(): readonly { text: string; x: number; y: number }[] {
    return SIGNAGE.map((p) => ({
      ...p,
      y: p.y >= CHUTE_BOTTOM ? p.y + this.shift : p.y,
    }))
  }

  /** Bottom of the chute rail (352 + Δ). */
  chuteBottom(): number {
    return CHUTE_BOTTOM + this.shift
  }

  /** Top-left of the belt gap tile between the last belt slot and the shelf (nodeId `shelf`). */
  gapTileY(): number {
    return slotY(this.beltSlots + 1)
  }

  /** The baseboard (2 px) along the room's south edge. */
  baseboardY(): number {
    return this.height - 2
  }

  /** Slot ids past the belt column (the ext strip's slots), in order. */
  extSlotIds(): string[] {
    const out: string[] = []
    for (let k = this.beltSlots + 1; k <= SLOT_COUNT; k++) out.push(`slot${k}`)
    return out
  }

  /** The ext strip's caption: `5–6`, `6`, or '' at tier 5. */
  extCaption(): string {
    const ks = this.extSlotIds().map((id) => id.replace(/\D+/g, ''))
    return ks.length > 1 ? `${ks[0]}–${ks[ks.length - 1]}` : (ks[0] ?? '')
  }

  has(nodeId: string): boolean {
    return this.table.has(nodeId)
  }

  rectFor(nodeId: string): Rect | null {
    const d = this.table.get(nodeId)
    return d ? { ...d.rect } : null
  }

  hitFor(nodeId: string): Rect | null {
    const d = this.table.get(nodeId)
    return d?.hit ? { ...d.hit } : null
  }

  anchorsFor(nodeId: string): NodeAnchors {
    const d = this.table.get(nodeId)
    if (!d) return { buffer: [], stations: [], entry: { x: 0, y: 0 } }
    const a = d.anchors
    return {
      buffer: a.buffer.map((p) => ({ ...p })),
      stations: a.stations.map((p) => ({ ...p })),
      entry: { ...a.entry },
      ...(a.outlet ? { outlet: { ...a.outlet } } : {}),
    }
  }

  labelFor(nodeId: string): string {
    return this.table.get(nodeId)?.label ?? nodeId
  }

  /** Default arrival point of a node (its head buffer spot, else entry). */
  arrival(nodeId: string): Point {
    const a = this.anchorsFor(nodeId)
    return a.buffer[0] ?? a.stations[0] ?? a.entry
  }

  pathBetween(
    fromNodeId: string,
    toNodeId: string,
    dest?: Point,
    start?: Point,
  ): Point[] {
    const to = dest ?? this.arrival(toNodeId)
    const from = this.table.get(fromNodeId)
    const toKind = kindOf(toNodeId)
    const fromKind = kindOf(fromNodeId)
    if (!from || !this.table.has(toNodeId)) return [to]
    if (fromKind === 'conveyor' && toKind !== 'conveyor') {
      // Along the dock belt to the corner, then down the column; a dock 2–3
      // pad parcel first hops north onto conv1's line (design-m8-m9 §6.1).
      const corner = { x: BELT_CX, y: 64 }
      return this.isPad(fromNodeId)
        ? [{ ...PAD_EXIT }, corner, to]
        : [corner, to]
    }
    if (fromKind === 'slot' && toNodeId === 'hold') {
      // The divert edge: out of the side outlet onto the chute, down it to
      // the bay's row, then into the bay (§3.3 timeline).
      const y = from.anchors.outlet?.y ?? to.y
      return [{ x: CHUTE_CX, y }, { x: CHUTE_CX, y: to.y }, to]
    }
    const dy = this.shift
    if (fromKind === 'slot' && toKind === 'shelf') {
      return [{ x: BELT_CX, y: 388 + dy }, to]
    }
    if (fromNodeId === 'hold' && toKind === 'shelf') {
      // Clear (§3.4): bay → chute → down → belt bottom → the shelf cell.
      const bayY = (start ?? this.arrival('hold')).y
      return [
        { x: CHUTE_CX, y: bayY },
        { x: CHUTE_CX, y: 368 + dy },
        { x: BELT_CX, y: 368 + dy },
        { x: BELT_CX, y: 388 + dy },
        to,
      ]
    }
    return [to]
  }

  /**
   * True when room point (x, y) is on the Hold Bay station's tap rect (it is
   * not a lane node, so nodeAt never returns it; the scene asks first).
   */
  stationAt(x: number, y: number): boolean {
    return containsPt(HOLD_STATION_HIT, x, y)
  }

  nodeAt(x: number, y: number): string | null {
    // Most specific first: belt slots (incl. the desk's west hit strip is
    // the caller's), bays, bin, shelf, extension, dock.
    const order: string[] = []
    for (let k = 1; k <= this.beltSlots; k++) order.push(`slot${k}`)
    order.push('hold', 'bin', 'shelf')
    const ext = this.extSlotIds()[0]
    if (ext) order.push(ext)
    order.push('dock1', 'dock2', 'dock3')
    for (const id of order) {
      const h = this.hitFor(id)
      if (h && containsPt(h, x, y)) return id
    }
    return null
  }

  // ---- per-node fixtures (renderer helpers, still keyed by node id) --------

  /** Machine sprite (48 × 48) top-left: centred on the processing anchor. */
  machineAt(nodeId: string): Point | null {
    const st = this.anchorsFor(nodeId).stations[0]
    if (!st || !isSlotId(nodeId) || !this.isBeltSlot(nodeId)) return null
    return { x: st.x - 24, y: st.y - 24 }
  }

  /** Desk sprite (48 × 32) top-left, west of the belt. */
  deskAt(nodeId: string): Point | null {
    const r = this.rectFor(nodeId)
    if (!r || !this.isBeltSlot(nodeId)) return null
    return { x: 80, y: r.y + 20 }
  }

  /**
   * The desk's extra hit strip west of the slot: (56, y_k, 40, 64) — M8
   * (design-m8-m9 R7) moved it off the dock 2–3 pads (was 48 wide from x 48).
   */
  deskHit(nodeId: string): Rect | null {
    const r = this.rectFor(nodeId)
    if (!r || !this.isBeltSlot(nodeId)) return null
    return { x: DESK_HIT_X, y: r.y, w: 96 - DESK_HIT_X, h: 64 }
  }

  /** Inspector stand points w1–w3 (feet), facing the belt (east). */
  standPoints(nodeId: string): Point[] {
    const r = this.rectFor(nodeId)
    if (!r || !this.isBeltSlot(nodeId)) return []
    return [
      { x: W1_X, y: r.y + 36 },
      { x: 84, y: r.y + 10 },
      { x: 108, y: r.y + 10 },
    ]
  }

  /** Walk path from the dock door to a stand point at slot `nodeId` (§1.12). */
  walkPath(nodeId: string, stand: Point): Point[] {
    const r = this.rectFor(nodeId)
    const y = r ? r.y + 36 : stand.y
    return [
      { ...DOOR_POINT },
      { x: AISLE_X, y: DOOR_POINT.y },
      { x: AISLE_X, y },
      { x: stand.x, y },
      stand,
    ]
  }

  /**
   * Walk path from the dock door to the Hold Bay station's stand point (a
   * sorter's hire, M6): down the aisle, east along STATION_ROW_Y south of
   * the rack, then up into the station. Axis-aligned legs.
   */
  stationWalkPath(): Point[] {
    return [
      { ...DOOR_POINT },
      { x: AISLE_X, y: DOOR_POINT.y },
      { x: AISLE_X, y: STATION_ROW_Y },
      { x: SORTER_STAND.x, y: STATION_ROW_Y },
      { ...SORTER_STAND },
    ]
  }

  /** The way back out from `from` (a sorter's fire / walkout): the walk-in, reversed. */
  stationExitPath(from: Point): Point[] {
    return [
      { x: from.x, y: STATION_ROW_Y },
      { x: AISLE_X, y: STATION_ROW_Y },
      { x: AISLE_X, y: DOOR_POINT.y },
      { ...DOOR_POINT },
    ]
  }

  /** The "+" badge centre over an empty slot (§1.6). */
  plusAt(nodeId: string): Point | null {
    const st = this.anchorsFor(nodeId).stations[0]
    return st && this.isBeltSlot(nodeId) ? { ...st } : null
  }

  /** Chute outlet sprite (12 × 12) top-left for a slot. */
  outletAt(nodeId: string): Point | null {
    const r = this.rectFor(nodeId)
    if (!r || !this.isBeltSlot(nodeId)) return null
    return { x: 160, y: r.y + 34 }
  }

  /** Slot ids drawn in the belt column (1..beltSlots); the rest share the ext strip. */
  isBeltSlot(nodeId: string): boolean {
    const m = /^slot([1-9]\d*)$/.exec(nodeId)
    return m !== null && Number(m[1]) <= this.beltSlots
  }

  /** The dashed extension strip (slots past the belt column), or null at tier 5. */
  extRect(): Rect | null {
    const id = this.extSlotIds()[0]
    return id ? this.rectFor(id) : null
  }

  /** Belt tiles of the fixed lane (dock belt, corner, the column). */
  beltTiles(): BeltTile[] {
    const out: BeltTile[] = []
    for (let x = 32; x < BELT_X; x += TILE)
      out.push({ x, y: 48, stem: 'belt_h', nodeId: 'conv1' })
    out.push({ x: BELT_X, y: 48, stem: 'belt_corner', nodeId: 'conv1' })
    // The 16 px between the corner (ends y 80) and slot 1 (y 96): a full
    // tile at y 80 partly covered by slot 1's first tile.
    out.push({ x: BELT_X, y: 80, stem: 'belt_v', nodeId: 'conv1' })
    for (let k = 1; k <= this.beltSlots; k++) {
      const y = slotY(k)
      out.push({ x: BELT_X, y, stem: 'belt_v', nodeId: `slot${k}` })
      out.push({ x: BELT_X, y: y + TILE, stem: 'belt_v', nodeId: `slot${k}` })
    }
    out.push({ x: BELT_X, y: this.gapTileY(), stem: 'belt_v', nodeId: 'shelf' })
    return out
  }

  /** Chute rail segments (16 × 32 at x 172, top-left), down to chuteBottom(). */
  chuteSegments(): Point[] {
    const out: Point[] = []
    const bottom = this.chuteBottom()
    for (let y = CHUTE_TOP; y < bottom; y += TILE) out.push({ x: CHUTE_X, y })
    return out
  }
}

/** Node kind from the fixed id scheme (plan.md §5 lane node ids). */
function kindOf(id: string): string {
  if (/^dock\d+$/.test(id)) return 'dock'
  if (/^conv\d+$/.test(id)) return 'conveyor'
  if (isSlotId(id)) return 'slot'
  if (id === 'hold') return 'holdBay'
  return id
}

function isSlotId(id: string): boolean {
  return /^slot\d+$/.test(id)
}

// ---- screen placement (§1.1) and the vertical scroll (M9) ----------------------

export interface RoomPlacement {
  /** Room container top-left in screen px (unscrolled: room px 0 at scroll 0). */
  roomX: number
  roomY: number
  /** Readout strip (screen px): glued 24 px above the room, fixed while it scrolls (R10). */
  readout: Rect
  /** True when the room + strip fit between the HUD bands (no scroll). */
  fits: boolean
  /** Screen px the room is visible in: the room itself when it fits, else the band below the strip. */
  viewport: Rect
  /** Largest scroll (room px; 0 when it fits). */
  maxScroll: number
}

/**
 * Where the room goes on a W × H canvas between the HUD bands (top band
 * ends at `bandTop`, bottom band starts at `bandBottom`; with no safe-area
 * insets these are HUD_TOP_H = 64 and H − HUD_BOTTOM_H), for a room
 * `roomH` px tall (default the tier-1 448):
 * roomX = floor((W − 352) / 2); when roomH + 28 fits,
 * roomY = bandTop + 28 + floor((bandBottom − bandTop − roomH − 28) / 2)
 * (exactly playtest 1's placement); a block up to ROOM_SLACK px too tall
 * still fits, the strip moved up into its 4-px top margin (M9 review: at
 * 375 × 667 tier 4 overflows by 1 px — no scroll, no cover for it); else
 * (M9, B2 §4.4, R10) the strip sits at bandTop + 4, the room's top at
 * bandTop + 28 and the viewport is the band below the strip: maxScroll =
 * roomH − viewport.h (tier 4: 64 at 360 × 604, 9 at 393 × 659; tier 5:
 * 128 / 73).
 */
export function roomPlacement(
  W: number,
  bandTop: number,
  bandBottom: number,
  roomH: number = ROOM_H,
): RoomPlacement {
  const roomX = Math.floor((W - ROOM_W) / 2)
  const block = roomH + (ROOM_BLOCK_H - ROOM_H)
  const free = bandBottom - bandTop - block
  const fitsV = free >= -ROOM_SLACK
  const roomY =
    bandTop + 28 + (free >= 0 ? Math.floor(free / 2) : fitsV ? free : 0)
  const viewH = fitsV ? roomH : Math.max(0, bandBottom - roomY)
  return {
    roomX,
    roomY,
    readout: { x: roomX, y: roomY - READOUT_GAP, w: ROOM_W, h: READOUT_H },
    fits: fitsV && roomX >= 0,
    viewport: fitsV
      ? { x: roomX, y: roomY, w: ROOM_W, h: roomH }
      : { x: 0, y: roomY, w: W, h: viewH },
    maxScroll: fitsV ? 0 : Math.max(0, roomH - viewH),
  }
}

/** An integer scroll in [0, maxScroll]. */
export function clampScroll(y: number, maxScroll: number): number {
  const m = Math.max(0, Math.floor(maxScroll))
  if (!Number.isFinite(y)) return 0
  return Math.min(m, Math.max(0, Math.round(y)))
}

/**
 * R22: a press drags the room (scrolls) when it travelled more than `slop`
 * px vertically and has not lifted a fixture; a lifted fixture never
 * scrolls (the 450-ms hold lifts only a press that has not moved).
 */
export function dragScrolls(
  dy: number,
  lifted: boolean,
  maxScroll: number,
  slop: number,
): boolean {
  return !lifted && maxScroll > 0 && Math.abs(dy) > slop
}

/** The scroll while dragging 1:1 (no inertia): the room follows the finger from the press. */
export function scrollForDrag(
  scroll0: number,
  dy: number,
  maxScroll: number,
): number {
  return clampScroll(scroll0 - dy, maxScroll)
}

/**
 * The smallest scroll change that shows room rect `r` inside the visible
 * window [scrollY, scrollY + viewH) — `viewH` may be cut short by an open
 * sheet; a rect taller than the window shows its top. Clamped.
 */
export function scrollToShow(
  r: Rect,
  scrollY: number,
  viewH: number,
  maxScroll: number,
  margin = 4,
): number {
  if (maxScroll <= 0) return 0
  let s = scrollY
  const top = r.y - margin
  const bottom = r.y + r.h + margin
  if (bottom > s + viewH) s = bottom - viewH
  if (top < s) s = top
  return clampScroll(s, maxScroll)
}

/**
 * The cover over everything outside the scrolling room's viewport (M9,
 * R10), as screen rects on a W × H canvas: the band above the viewport and
 * the one below it, each `bleed` px past the canvas edges on the outer sides
 * (the cover is a ui nine-slice whose rounded corner texels must stay off
 * screen); none while the room fits.
 */
export function coverRects(
  p: RoomPlacement,
  W: number,
  H: number,
  bleed: number,
): Rect[] {
  if (p.maxScroll <= 0) return []
  const v = p.viewport
  const below = v.y + v.h
  return [
    { x: -bleed, y: -bleed, w: W + 2 * bleed, h: v.y + bleed },
    {
      x: -bleed,
      y: below,
      w: W + 2 * bleed,
      h: Math.max(0, H - below) + bleed,
    },
  ]
}
