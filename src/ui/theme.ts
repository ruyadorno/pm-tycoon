// Palette colour constants for UI code (style-guide.md §1.7-§1.8). The values
// are copied from art/palette.json (the art pipeline's source of truth); a
// palette change there must be mirrored here. Numbers are 0xRRGGBB for
// Phaser tints/fills; CSS strings via css().

export const PALETTE = {
  outline: 0x241e32,
  grey0: 0x4e4858,
  grey1: 0x716a74,
  grey2: 0x948e90,
  grey3: 0xb7b0a8,
  grey4: 0xd9d2c4,
  grey5: 0xfcf9f1,
  grass0: 0x2f7d3a,
  grass1: 0x47a048,
  grass2: 0x6cc05a,
  grass3: 0x9bdc74,
  leaf0: 0x1f6a4a,
  leaf1: 0x2f8d5e,
  leaf2: 0x4bb27a,
  water0: 0x1d6fae,
  water1: 0x2f9bd6,
  water2: 0x5ec6ea,
  water3: 0xa5e8f4,
  blue0: 0x2d4d9c,
  blue1: 0x4c7bd0,
  blue2: 0x86b4ee,
  red0: 0xa8232e,
  red1: 0xe63e3e,
  red2: 0xff7f68,
  orange0: 0x8a3a1f,
  orange1: 0xc4582b,
  orange2: 0xea853d,
  orange3: 0xf6b168,
  yellow0: 0xb5760f,
  yellow1: 0xe8a526,
  yellow2: 0xf8d13e,
  yellow3: 0xfff38e,
  purple0: 0x5a3b86,
  purple1: 0x8a60bc,
  purple2: 0xbd99e0,
  pink0: 0xd4567c,
  pink1: 0xf6a0b6,
  brown0: 0x5a3a24,
  brown1: 0x8a5a3a,
  brown2: 0xc08a58,
  brown3: 0xe2bb8a,
  skin0: 0xf2ad7a,
  mal0: 0x301442,
  mal1: 0x4b1f66,
  mal2: 0x75399a,
  gold0: 0xcc7d00,
  gold1: 0xf5b000,
  gold2: 0xffe066,
} as const

export type PaletteId = keyof typeof PALETTE

/** '#rrggbb' for a palette colour (CSS, Phaser Text). */
export function css(id: PaletteId): string {
  return '#' + PALETTE[id].toString(16).padStart(6, '0')
}

/** Palette colour by id string (map.json regions[].colour); grey3 if unknown. */
export function paletteColour(id: string): number {
  return id in PALETTE ? PALETTE[id as PaletteId] : PALETTE.grey3
}

/** Semantic UI colours (style-guide.md §1.4, §1.7; city-view.md §3.1). */
export const THEME = {
  /** Game background: the deep sea beyond the map edge (water1). */
  background: PALETTE.water1,
  backgroundCss: '#2f9bd6',
  /** Text on light panels. */
  textDark: PALETTE.outline,
  /** Text on dark panels. */
  textLight: PALETTE.grey5,
  textMuted: PALETTE.grey2,
  panel: PALETTE.grey5,
  panelDark: PALETTE.grey0,
  outline: PALETTE.outline,
  /** On-time delivery stamp, money. */
  gold: PALETTE.gold1,
  /** Late delivery stamp, disabled text. */
  grey: PALETTE.grey2,
  /** State colours: ok / warning / danger. */
  ok: PALETTE.grass2,
  warn: PALETTE.yellow2,
  danger: PALETTE.red1,
  primary: PALETTE.blue1,
  chipActive: PALETTE.yellow2,
  malware: PALETTE.mal1,
  /** Drop shadow under city-overlay text. */
  shadow: 0x000000,
} as const

/** Bitmap font key and its two crisp sizes (phaser4-notes.md §7). */
export const FONT = 'm5x7'
export const FONT_SIZE = 16
export const FONT_SIZE_BIG = 32
