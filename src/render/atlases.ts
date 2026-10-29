// Texture keys (plan.md §5 "Atlas and frames", city-view.md §11.4). ONE atlas
// `world` holds every class incl. the nine-slices and the m5x7 glyph sheet, so
// the city, popups and HUD batch from one texture under autoMobileTextures.
// UI_ATLAS / WAREHOUSE_ATLAS alias it; if the packer ever overflows 2048², the
// warehouse classes move to an `interior` atlas by changing WAREHOUSE_ATLAS
// only (style-guide.md §3.7).

export const WORLD_ATLAS = 'world'
export const UI_ATLAS = WORLD_ATLAS
export const WAREHOUSE_ATLAS = WORLD_ATLAS

/** Loader URLs, relative to the page (vite base './'; public/assets/). */
export const WORLD_ATLAS_PNG = 'assets/world.png'
export const WORLD_ATLAS_JSON = 'assets/world.json'

/** BitmapFont: key, its frame inside `world`, and the BMFont XML descriptor. */
export const FONT_KEY = 'm5x7'
export const FONT_FRAME = 'm5x7'
export const FONT_XML_KEY = 'm5x7-xml'
export const FONT_XML_URL = 'assets/m5x7.xml'

/** The baked ground DynamicTexture (city-view.md §1.2). */
export const GROUND_TEXTURE = 'ground'
export const GROUND_W = 3072
export const GROUND_H = 1536
