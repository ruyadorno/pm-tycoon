// Frozen prompt templates + per-tool presets (style-guide.md §3.4). The
// full prompt text and every parameter are logged into gen[].params, so any
// sprite can be regenerated. Presets set view / outline / shading / detail /
// no_background / target_palette explicitly because tool defaults differ
// (isometric tile = lineless, map objects = single colour outline,
// characters = low top-down). Enum strings used here are asserted against
// the live OpenAPI document by pixellab.ts before the first call
// (PRESET_ENUMS), so a renamed enum fails fast instead of being guessed.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ManifestEntry } from './manifest.ts'
import { ROOT } from './manifest.ts'
import { PALETTE_PNG, subsetFor } from './palette.ts'

export const CITY_SUFFIX =
  ', 2:1 isometric pixel art, flat sunny daylight from the upper left, top ' +
  'faces lightest, left wall lighter than right wall, small sharp shadow, ' +
  '1px dark outline, flat fills, saturated clean colours, strong readable ' +
  'silhouette, centred, transparent background, no text, no people, no ' +
  'vehicles, no grid lines, no anti-aliasing'

/** storeys by district (style-guide §4.2), for the {storeys} slot */
export const STOREYS: Record<string, string> = {
  downtown: '3 to 6',
  highres: '3 to 5',
  industrial: '1 to 2',
  lowres: '1 to 2',
  rural: '1',
  civic: '2 to 3',
  docks: '1',
  airport: '1 to 2',
}

/** enum values the presets use, per OpenAPI request schema + property */
export const PRESET_ENUMS: { schema: string; prop: string; value: string }[] = [
  { schema: 'CreateMapObjectRequest', prop: 'view', value: 'high top-down' },
  {
    schema: 'CreateMapObjectRequest',
    prop: 'outline',
    value: 'single color outline',
  },
  {
    schema: 'CreateMapObjectRequest',
    prop: 'shading',
    value: 'medium shading',
  },
  { schema: 'CreateMapObjectRequest', prop: 'detail', value: 'medium detail' },
  {
    schema: 'CreateObjectProFlashRequest',
    prop: 'view',
    value: 'low top-down',
  },
  {
    schema: 'Create8DirectionObjectRequest',
    prop: 'view',
    value: 'low top-down',
  },
]

export interface Prompt {
  /** tool name logged in gen[].tool */
  tool: string
  /** REST v2 path */
  endpoint: string
  text: string
  /** request body without images (logged verbatim) */
  params: Record<string, unknown>
  /** images attached at call time (not logged as data) */
  attach: ('style_anchors' | 'palette_png' | 'floor_tile' | 'style_object')[]
  /** generations per call (budget estimate, §3.6) */
  cost: number
  /** candidates one call returns */
  perCall: number
}

/** palette hexes allowed for the entry's class (target_palette.colors) */
export function paletteColors(e: ManifestEntry): string[] {
  return subsetFor(e.class, { district: e.district }).map((c) => c.hex)
}

export function palettePngBase64(): string {
  return readFileSync(PALETTE_PNG).toString('base64')
}

export const FLOOR_TILE_PNG = join(
  ROOT,
  'art/final/interior-tile/floor_t1_0.png',
)

/** Pro Flash cost in generations by longest side (5 / 6 / 9) */
export function proFlashCost(w: number, h: number): number {
  const s = Math.max(w, h)
  return s <= 96 ? 5 : s <= 160 ? 6 : 9
}

export function promptFor(e: ManifestEntry): Prompt {
  const [W, H] = e.canvas
  const subject = e.subject ?? e.id.replace(/_/g, ' ')
  const target_palette = { colors: paletteColors(e), max_colors: 20 }
  switch (e.class) {
    case 'building1x1':
    case 'building2x2':
    case 'building3x3': {
      const fw = 64 * (e.footprint?.[0] ?? 1)
      const text =
        `${subject}, a single building standing on a ${fw}x${fw / 2} ` +
        'isometric diamond plot with a small paved yard, ' +
        `${STOREYS[e.district ?? ''] ?? '2 to 3'} storeys, bright cheerful ` +
        `city-builder style${CITY_SUFFIX}`
      if (Math.max(W, H) <= 170) {
        return {
          tool: 'generate-with-style-v2',
          endpoint: '/generate-with-style-v2',
          text,
          params: { description: text, no_background: true, target_palette },
          attach: ['style_anchors'],
          cost: Math.max(W, H) <= 96 ? 10 : 15,
          perCall: 4,
        }
      }
      return {
        tool: 'create-image-pro-flash',
        endpoint: '/create-image-pro-flash',
        text,
        params: {
          description: text,
          image_size: { width: W, height: H },
          no_background: true,
          target_palette,
        },
        attach: ['style_anchors'],
        cost: proFlashCost(W, H),
        perCall: 1,
      }
    }
    case 'warehouse-ext': {
      const text =
        'corrugated tin delivery warehouse on a 256x128 isometric plot, ' +
        'loading dock doors on the left (west) wall, flat roof, small office, ' +
        `scrappy start-up look${CITY_SUFFIX}`
      return {
        tool: 'create-image-pro-flash',
        endpoint: '/create-image-pro-flash',
        text,
        params: {
          description: text,
          image_size: { width: 256, height: 256 },
          no_background: true,
          target_palette,
          t2_edit: {
            endpoint: '/edit-image-pro-flash',
            description:
              'repaint the walls blue, add a company sign board over the ' +
              'doors, cleaner roof',
          },
        },
        attach: ['style_anchors'],
        cost: proFlashCost(256, 256),
        perCall: 1,
      }
    }
    case 'prop':
    case 'dock-prop': {
      const text = `${subject}, isometric pixel art prop${CITY_SUFFIX}`
      return {
        tool: 'create-image-pro-flash',
        endpoint: '/create-image-pro-flash',
        text,
        params: {
          description: text,
          image_size: { width: W, height: H },
          no_background: true,
          target_palette,
        },
        attach: ['style_anchors'],
        cost: proFlashCost(W, H),
        perCall: 1,
      }
    }
    case 'vehicle-bike':
    case 'vehicle-van':
    case 'vehicle-truck': {
      const text =
        `${subject}, small delivery vehicle, bright colour, toy-like ` +
        'proportions, 1px dark outline, flat fills'
      if (e.class === 'vehicle-van') {
        return {
          tool: 'create-object-pro-flash',
          endpoint: '/create-object-pro-flash',
          text,
          params: {
            description: text,
            n_directions: 8,
            view: 'low top-down',
            image_size: { width: 32, height: 32 },
            target_palette,
          },
          attach: [],
          cost: 17,
          perCall: 1,
        }
      }
      return {
        tool: 'create-8-direction-object',
        endpoint: '/create-8-direction-object',
        text,
        params: {
          description: text,
          size: e.class === 'vehicle-bike' ? 24 : 48,
          view: 'low top-down',
          target_palette,
        },
        attach: ['style_object'],
        cost: 25,
        perCall: 1,
      }
    }
    case 'worker': {
      const text =
        'warehouse inspector in a yellow vest and cap, friendly, chunky ' +
        'proportions'
      return {
        tool: 'create-character-with-4-directions',
        endpoint: '/create-character-with-4-directions',
        text,
        params: {
          description: text,
          image_size: { width: 32, height: 32 },
          view: 'high top-down',
          outline: 'single color black outline',
          shading: 'basic shading',
          detail: 'medium detail',
        },
        attach: ['palette_png'],
        cost: 1,
        perCall: 1,
      }
    }
    default: {
      // machines, fixtures, desk, shelves: map objects on the floor tile
      const text =
        `${subject}, top-down 3/4 warehouse machine on a concrete floor, ` +
        'chunky, bright, 1px dark outline'
      return {
        tool: 'map-objects',
        endpoint: '/map-objects',
        text,
        params: {
          description: text,
          image_size: { width: W, height: H },
          view: 'high top-down',
          outline: 'single color outline',
          shading: 'medium shading',
          detail: 'medium detail',
        },
        attach: ['palette_png', 'floor_tile'],
        cost: 1,
        perCall: 1,
      }
    }
  }
}
