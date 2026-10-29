// Typed frame accessors (plan.md §5 "Atlas and frames", style-guide.md §7).
// Scenes reach atlas frames through this module; it re-exports everything
// `vlr art:atlas` generates (FRAMES, FrameName, isFrame, frame, roadFrame,
// vehicleFrame, buildingFrame, SPRITE_MAP, VEHICLE_FOOT, SMOKE_ANCHORS,
// SIGN_FACE, ROAD_N..W) and adds the few lookups the views share. A frame
// that is not in the atlas is a type error for literals and a thrown error
// (frame()) or null (the *OrNull helpers) for computed names.
import { SPRITE_MAP, isFrame, type FrameName } from './frames.generated.ts'

export * from './frames.generated.ts'

/** The atlas sprite stem drawn for a buildings.json row (locked scenery shares sprites). */
export function buildingSprite(buildingId: string): string {
  return SPRITE_MAP[buildingId] ?? buildingId
}

/** `name` when the atlas has it, else null. */
export function frameOrNull(name: string): FrameName | null {
  return isFrame(name) ? name : null
}

/**
 * `<stem>_locked` while the region is fogged and that frame exists, else the
 * stem itself; null when the atlas has neither (city-view.md §1.4: the caller
 * then falls back to the flat-fill tint, map.json lockedStyle 'fill').
 */
export function lockedFrame(stem: string, locked: boolean): FrameName | null {
  if (locked && isFrame(`${stem}_locked`)) return `${stem}_locked` as FrameName
  return frameOrNull(stem)
}

/** True when a locked region has a real `_locked` frame for `stem`. */
export function hasLockedFrame(stem: string): boolean {
  return isFrame(`${stem}_locked`)
}
