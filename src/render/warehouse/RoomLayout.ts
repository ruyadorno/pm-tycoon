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
/** Minimum viewport that fits without scrolling (§1.1). */
export const MIN_VIEW_W = 360
export const MIN_VIEW_H = 604

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
/** North-wall sign and its BitmapText face (artUi: x 8..191, y 4..19). */
export const SIGN = { x: 76, y: 4, w: 200, h: 24 } as const
export const SIGN_TEXT = { x: 84, y: 8, w: 184, h: 16 } as const
export const BULB = { x: 296, y: 6 } as const
export const STRIP_LIGHTS: readonly Point[] = [
  { x: 8, y: 2 },
  { x: 280, y: 2 },
]
/** Tier props (§5.1 / §5.2) and the wanted poster (hit padded to 44). */
export const PROPS_T1: readonly Point[] = [
  { x: 264, y: 120 },
  { x: 264, y: 280 },
]
export const PROPS_T2: readonly Point[] = [{ x: 264, y: 112 }]
export const POSTER = { x: 272, y: 200, w: 32, h: 32 } as const
export const POSTER_HIT = { x: 266, y: 194, w: 44, h: 44 } as const
/** Tier-2 signage plates (§5.2): text + top-left. */
export const SIGNAGE: readonly { text: string; x: number; y: number }[] = [
  { text: 'INTAKE', x: 40, y: 34 },
  { text: 'HOLD', x: 200, y: 80 },
  { text: 'SHELF', x: 36, y: 370 },
  { text: 'QUARANTINE', x: 252, y: 368 },
]
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

/** The one-dashed-outline extension strip for slots 5–6 (§1.3 `ext`). */
const EXT_RECT: Rect = { x: 72, y: 356, w: 56, h: 24 }
const EXT_HIT: Rect = { x: 72, y: 352, w: 56, h: 32 }

function extDef(k: number): NodeDef {
  return {
    label: `Slot ${k}`,
    rect: EXT_RECT,
    hit: EXT_HIT,
    anchors: {
      buffer: [{ x: BELT_CX, y: 368 }],
      stations: [{ x: BELT_CX, y: 368 }],
      entry: { x: BELT_CX, y: 368 },
    },
  }
}

/** Shelf cell i (oldest first): top-left of its 10 × 10 mini. */
export function shelfCell(i: number): Point {
  const c = i % SHELF_COLS
  const r = Math.floor(i / SHELF_COLS) % SHELF_ROWS
  return {
    x: SHELF_ORIGIN.x + c * SHELF_PITCH,
    y: SHELF_ORIGIN.y + r * SHELF_PITCH,
  }
}

/** Top-left of bay i's pad (44 × 44). */
export function bayRect(i: number): Rect {
  return { x: 196, y: 100 + BAY_PITCH * i, w: 44, h: 44 }
}

function buildTable(): Map<string, NodeDef> {
  const t = new Map<string, NodeDef>()
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
  for (let k = 1; k <= 4; k++) t.set(`slot${k}`, slotDef(k))
  t.set('slot5', extDef(5))
  t.set('slot6', extDef(6))
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
    rect: { x: 256, y: 384, w: 64, h: 64 },
    hit: { x: 256, y: 384, w: 64, h: 64 },
    anchors: { buffer: [], stations: [], entry: { x: 288, y: 404 } },
  })
  t.set('shelf', {
    label: 'Shelf',
    rect: { x: 32, y: 384, w: 224, h: 64 },
    hit: { x: 32, y: 384, w: 224, h: 64 },
    anchors: {
      buffer: Array.from({ length: SHELF_COLS * SHELF_ROWS }, (_, i) => {
        const c = shelfCell(i)
        return { x: c.x + 5, y: c.y + 5 }
      }),
      stations: [],
      entry: { x: BELT_CX, y: 388 },
    },
  })
  return t
}

const containsPt = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h

/**
 * The fixed playtest-1 lane (spec §6.1-§6.2): one dock, the dock conveyor,
 * slots 1–4 in the belt column, slots 5–6 as the dashed extension strip,
 * the Hold Bay rack, the Quarantine Bin and the shelf.
 */
export class FixedLaneLayout implements LaneLayout {
  readonly width = ROOM_W
  readonly height = ROOM_H
  private readonly table = buildTable()

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
      // Along the dock belt to the corner, then down the column.
      return [{ x: BELT_CX, y: 64 }, to]
    }
    if (fromKind === 'slot' && toNodeId === 'hold') {
      // The divert edge: out of the side outlet onto the chute, down it to
      // the bay's row, then into the bay (§3.3 timeline).
      const y = from.anchors.outlet?.y ?? to.y
      return [{ x: CHUTE_CX, y }, { x: CHUTE_CX, y: to.y }, to]
    }
    if (fromKind === 'slot' && toKind === 'shelf') {
      return [{ x: BELT_CX, y: 388 }, to]
    }
    if (fromNodeId === 'hold' && toKind === 'shelf') {
      // Clear (§3.4): bay → chute → down → belt bottom → the shelf cell.
      const bayY = (start ?? this.arrival('hold')).y
      return [
        { x: CHUTE_CX, y: bayY },
        { x: CHUTE_CX, y: 368 },
        { x: BELT_CX, y: 368 },
        { x: BELT_CX, y: 388 },
        to,
      ]
    }
    return [to]
  }

  nodeAt(x: number, y: number): string | null {
    // Most specific first: slots (incl. the desk's west hit strip is the
    // caller's), bays, bin, shelf, extension, dock.
    const order = [
      'slot1',
      'slot2',
      'slot3',
      'slot4',
      'hold',
      'bin',
      'shelf',
      'slot5',
      'dock1',
    ]
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

  /** The desk's extra hit strip west of the slot (48, y_k, 48, 64). */
  deskHit(nodeId: string): Rect | null {
    const r = this.rectFor(nodeId)
    if (!r || !this.isBeltSlot(nodeId)) return null
    return { x: 48, y: r.y, w: 48, h: 64 }
  }

  /** Inspector stand points w1–w3 (feet), facing the belt (east). */
  standPoints(nodeId: string): Point[] {
    const r = this.rectFor(nodeId)
    if (!r || !this.isBeltSlot(nodeId)) return []
    return [
      { x: 60, y: r.y + 36 },
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
      { x: 56, y: DOOR_POINT.y },
      { x: 56, y },
      { x: stand.x, y },
      stand,
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

  /** Slot ids drawn in the belt column (1–4); 5–6 share the ext strip. */
  isBeltSlot(nodeId: string): boolean {
    return /^slot[1-4]$/.test(nodeId)
  }

  /** The dashed extension strip (slots past the belt column). */
  extRect(): Rect {
    return { ...EXT_RECT }
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
    for (let k = 1; k <= 4; k++) {
      const y = slotY(k)
      out.push({ x: BELT_X, y, stem: 'belt_v', nodeId: `slot${k}` })
      out.push({ x: BELT_X, y: y + TILE, stem: 'belt_v', nodeId: `slot${k}` })
    }
    out.push({ x: BELT_X, y: 352, stem: 'belt_v', nodeId: 'shelf' })
    return out
  }

  /** Chute rail segments (16 × 32 at x 172, top-left). */
  chuteSegments(): Point[] {
    const out: Point[] = []
    for (let y = CHUTE_TOP; y < CHUTE_BOTTOM; y += TILE)
      out.push({ x: CHUTE_X, y })
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

// ---- screen placement (§1.1) ---------------------------------------------------

export interface RoomPlacement {
  /** Room container top-left in screen px. */
  roomX: number
  roomY: number
  /** Readout strip (screen px). */
  readout: Rect
  /** True when the room + strip fit between the HUD bands. */
  fits: boolean
}

/**
 * Where the room goes on a W × H canvas between the HUD bands (top band
 * ends at `bandTop`, bottom band starts at `bandBottom`; with no safe-area
 * insets these are HUD_TOP_H = 64 and H − HUD_BOTTOM_H):
 * roomX = floor((W − 352) / 2),
 * roomY = bandTop + 28 + floor(max(0, bandBottom − bandTop − 476) / 2).
 */
export function roomPlacement(
  W: number,
  bandTop: number,
  bandBottom: number,
): RoomPlacement {
  const roomX = Math.floor((W - ROOM_W) / 2)
  const free = bandBottom - bandTop - ROOM_BLOCK_H
  const roomY = bandTop + 28 + Math.floor(Math.max(0, free) / 2)
  return {
    roomX,
    roomY,
    readout: { x: roomX, y: roomY - READOUT_GAP, w: ROOM_W, h: READOUT_H },
    fits: free >= 0 && roomX >= 0,
  }
}
