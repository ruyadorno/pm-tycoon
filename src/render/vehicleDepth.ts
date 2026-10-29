// Vehicle depth against multi-tile footprints (city-view.md §1.3; M4 bug
// hunt). The notes' rule — buildings at the max tx + ty of their footprint,
// vehicles at their fractional tx + ty — is exact for 1×1 tiles only. A
// vehicle on the avenue along the SE (+tx) or SW (+ty) face of an n×n
// building is in front of that face, yet over the back n − 1 tiles of the
// face its tx + ty is below the footprint's max: the wall of a 3×3 tower or
// plant clipped the corner of a truck passing in front of it, and the lot's
// queue/parking tiles beside the 4×4 warehouse tied with it. sortDepth() keeps the fractional base and
// only raises it above the footprints the vehicle is strictly in front of
// whose sprites overlap it on screen, never past one it is strictly behind
// (that case keeps the base: no scalar fits). Pure (no Phaser) for
// tests/render/vehicle-depth.test.ts.

/** A footprint that can hide a vehicle (tile bounds inclusive, sprite rect in world px). */
export interface Occluder {
  x0: number
  y0: number
  x1: number
  y1: number
  /** The footprint's depth (max tx + ty). */
  depth: number
  left: number
  top: number
  right: number
  bottom: number
}

/** Screen rect of the vehicle sprite (world px). */
export interface SpriteRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Over the footprint's own overlays (mood +0.01, scorch +0.015, smoke
 * +0.03) and below the next whole depth step.
 */
export const IN_FRONT_BIAS = 0.05
/**
 * Vehicles lifted over the same footprint keep their tx + ty order (a queue
 * along the face): + base × this (≤ 0.01 on the 48 × 48 map).
 */
export const BASE_ORDER = 1e-4

/** Strictly on the +tx or +ty side of the footprint (in front of a face). */
export function inFront(tx: number, ty: number, o: Occluder): boolean {
  return tx > o.x1 + 0.5 || ty > o.y1 + 0.5
}

/** Strictly on the −tx or −ty side of the footprint (behind a face). */
export function behind(tx: number, ty: number, o: Occluder): boolean {
  return tx < o.x0 - 0.5 || ty < o.y0 - 0.5
}

function overlaps(r: SpriteRect, o: Occluder): boolean {
  return (
    r.right > o.left && r.left < o.right && r.bottom > o.top && r.top < o.bottom
  )
}

/**
 * Depth for a vehicle at fractional tile (tx, ty) whose sprite covers `rect`:
 * `base` (tx + ty) raised to just above every overlapping footprint it is in
 * front of (+ base × BASE_ORDER), as long as that stays below every
 * overlapping footprint it is behind. A vehicle on a diagonal corner (both sides) or inside a footprint
 * (the lot's dock pose) leaves that footprint out.
 */
export function sortDepth(
  tx: number,
  ty: number,
  base: number,
  rect: SpriteRect,
  occluders: Iterable<Occluder>,
): number {
  let lo = base
  let hi = Infinity
  for (const o of occluders) {
    if (!overlaps(rect, o)) continue
    const f = inFront(tx, ty, o)
    const b = behind(tx, ty, o)
    if (f === b) continue
    if (f) lo = Math.max(lo, o.depth + IN_FRONT_BIAS + base * BASE_ORDER)
    else hi = Math.min(hi, o.depth)
  }
  return lo < hi ? lo : base
}
