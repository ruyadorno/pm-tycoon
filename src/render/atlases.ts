// Texture keys (plan.md §5 "Atlas and frames", city-view.md §11.4,
// spec-build2 §6.8). TWO atlases since build 2 (tools/art/atlas.ts has the
// placement rule):
//   `world`     the city, the UI nine-slices, icons, parcels, fx, machines,
//               workers and the m5x7 glyph sheet: the city, popups, the HUD
//               and the warehouse room's FRONT layers (parcels, machines,
//               workers, badges, fx, readout) bind it alone;
//   `interior`  the room's BACK layers (floors, walls, belts, fixtures, the
//               dock tail) plus copies of the shared small art and of the
//               glyph sheet (ROOM_FONT_KEY), so the back layers batch from it
//               alone and the room costs one texture switch per frame.
// Which atlas holds a frame: FRAME_ATLAS / inAtlas() in frames.generated.ts;
// back layers bind roomAtlas(name), front layers and UI atlasOf(name)
// (frames.ts). The loader URLs are the content-hashed Vite `?url` imports of
// src/render/assetUrls.ts (the only module with `?url` imports); this module
// stays Phaser- and Vite-free so Node tools and Vitest can load it.

export const WORLD_ATLAS = 'world'
export const INTERIOR_ATLAS = 'interior'
export const UI_ATLAS = WORLD_ATLAS
export const WAREHOUSE_ATLAS = INTERIOR_ATLAS

/** Every packed atlas, in load order. */
export const ATLAS_KEYS = [WORLD_ATLAS, INTERIOR_ATLAS] as const

/** The prepared logo (src/assets/logo.png), its own texture (spec-build2 §5). */
export const LOGO_KEY = 'logo'
/** The attract-mode snapshot (src/assets/attract.json) in the JSON cache. */
export const ATTRACT_KEY = 'attract'

/** BitmapFont: key, its frame inside `world`, and the BMFont XML cache key. */
export const FONT_KEY = 'm5x7'
export const FONT_FRAME = 'm5x7'
export const FONT_XML_KEY = 'm5x7-xml'
/** The same m5x7 parsed from `interior` (text inside the room's back layers). */
export const ROOM_FONT_KEY = 'm5x7-interior'

/** The baked ground DynamicTexture (city-view.md §1.2). */
export const GROUND_TEXTURE = 'ground'
export const GROUND_W = 3072
export const GROUND_H = 1536
