// Typed frame accessors (plan.md §5 "Atlas and frames", style-guide.md §7).
// Scenes reach atlas frames through this module; it re-exports everything
// `vlr art:atlas` generates (FRAMES, FrameName, FRAME_ATLAS, SHARED_FRAMES,
// inAtlas, isFrame, frame, roadFrame, vehicleFrame, buildingFrame,
// SPRITE_MAP, VEHICLE_FOOT, SMOKE_ANCHORS, SIGN_FACE, ROAD_N..W) and adds the
// few lookups the views share. A frame that is not in the atlases is a type
// error for literals and a thrown error (frame()) or null (the *OrNull
// helpers) for computed names.
import { INTERIOR_ATLAS, WORLD_ATLAS } from './atlases.ts'
import {
  FRAME_ATLAS,
  SPRITE_MAP,
  inAtlas,
  isFrame,
  type AtlasKey,
  type FrameName,
} from './frames.generated.ts'

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
 * The atlas a world-bound surface binds for `name`: `world` when the frame
 * is packed there (incl. the shared frames, and unknown names), else
 * `interior`. The city, the HUD, src/ui/** and the warehouse room's FRONT
 * layers (parcels, machines, workers, badges, fx: they carry the panels and
 * the m5x7 text) use it (spec-build2 §6.8).
 */
export function atlasOf(name: string): AtlasKey {
  return isFrame(name) ? FRAME_ATLAS[name] : WORLD_ATLAS
}

/**
 * The texture the warehouse room's BACK layers (floor, walls, belts,
 * fixtures, tail) bind for `name`: `interior` when the frame is packed there
 * (room art and the shared icons, parcels, fx, machines, workers), else
 * `world` — so the static room batches from one texture under
 * autoMobileTextures (spec-build2 §6.8, tools/art/atlas.ts).
 */
export function roomAtlas(name: string): AtlasKey {
  return inAtlas(name, INTERIOR_ATLAS) ? INTERIOR_ATLAS : WORLD_ATLAS
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
