// Isometric maths for 64x32 2:1 tiles (phaser4-notes.md §2, verbatim API).
// Pure: no Phaser, no DOM — tools/ and Vitest import it under plain Node.
//
// Convention: tile (tx, ty) screen point = the CENTRE of its diamond.
// +tx runs down-right (SE on screen), +ty runs down-left (SW); the map's tile
// (0, 0) is the top vertex of the world. `ox` is the screen x of tile (0,0)'s
// centre, chosen so the whole map has x >= 0 (originX).

export const TW = 64
export const TH = 32
export const HW = 32
export const HH = 16

export interface ScreenXY {
  x: number
  y: number
}

export interface TileF {
  tx: number
  ty: number
}

/** Screen x of tile (0,0)'s centre so the whole map has x >= 0. */
export const originX = (mapH: number): number => mapH * HW

/** Centre of tile (tx, ty)'s diamond (fractional tiles allowed: vehicles). */
export function tileToScreen(
  tx: number,
  ty: number,
  ox: number,
  out: ScreenXY = { x: 0, y: 0 },
): ScreenXY {
  out.x = ox + (tx - ty) * HW
  out.y = (tx + ty) * HH
  return out
}

/** Inverse of tileToScreen, continuous. */
export function screenToTileF(sx: number, sy: number, ox: number): TileF {
  const dx = sx - ox
  const dy = sy
  return { tx: 0.5 * (dx / HW + dy / HH), ty: 0.5 * (dy / HH - dx / HW) }
}

/** The tile whose diamond contains the screen point (tap -> tile). */
export function pickTile(sx: number, sy: number, ox: number): TileF {
  const f = screenToTileF(sx, sy, ox)
  return { tx: Math.floor(f.tx + 0.5), ty: Math.floor(f.ty + 0.5) }
}

/** World size in px of a mapW x mapH diamond: (w+h)*HW by (w+h)*HH. */
export function worldSize(
  mapW: number,
  mapH: number,
): { w: number; h: number } {
  return { w: (mapW + mapH) * HW, h: (mapW + mapH) * HH }
}

/**
 * Top-left of tile (tx, ty)'s 64x32 bounding box (what DynamicTexture.stamp
 * wants with origin 0,0): the centre minus (HW, HH).
 */
export function tileTopLeft(
  tx: number,
  ty: number,
  ox: number,
  out: ScreenXY = { x: 0, y: 0 },
): ScreenXY {
  out.x = ox + (tx - ty) * HW - HW
  out.y = (tx + ty) * HH - HH
  return out
}

/**
 * Anchor of a building sprite with origin (0.5, 1): the bottom vertex of its
 * footprint's front tile (max tx+ty, notes §2). `tile` is the footprint's
 * top-left tile. Footprints are square (1x1..4x4), so this x is also the
 * footprint diamond's centre line.
 */
export function footprintAnchor(
  tile: readonly [number, number],
  footprint: readonly [number, number],
  ox: number,
  out: ScreenXY = { x: 0, y: 0 },
): ScreenXY {
  const fx = tile[0] + footprint[0] - 1
  const fy = tile[1] + footprint[1] - 1
  out.x = ox + (fx - fy) * HW
  out.y = (fx + fy) * HH + HH
  return out
}

/** Depth of a footprint: the max tx+ty of its tiles (notes §2). */
export function footprintDepth(
  tile: readonly [number, number],
  footprint: readonly [number, number],
): number {
  return tile[0] + footprint[0] - 1 + tile[1] + footprint[1] - 1
}
