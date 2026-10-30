// Frozen prompt templates + per-tool presets (style-guide.md §3.4). The
// full prompt text and every parameter are logged into gen[].params, so any
// sprite can be regenerated. Presets set view / outline / shading / detail /
// no_background / target_palette explicitly where the endpoint has them,
// because tool defaults differ. Enum strings used here are asserted
// against the live OpenAPI document by pixellab.ts before the first call
// (PRESET_ENUMS), and every request body is validated against its schema
// (unknown fields are a 422 there), so drift fails fast.
//
// Tool choice per class, as exercised on the live API (G2, 2026-10-29):
// - buildings: /create-image-pro-flash at the class canvas (custom size,
//   no_background) while no approved style anchors exist (the anchor pass:
//   /generate-with-style-v2 *requires* style_images); with anchors,
//   /generate-with-style-v2 (4 candidates per call) when the anchors have
//   the target's longest side (its output is a square of the largest style
//   image), else Pro Flash with the first anchor that fits as style_image.
// - van: /create-object-pro-flash n_directions 8 (6 generations at 32x32);
//   bike/truck: /create-8-direction-object with style_object_id = the
//   chosen van's object_id.
// - machines / fixtures: /create-image-pro-flash at the class canvas
//   (/map-objects at 48x48 drew a 24x18 spindly object — unusable).
// - worker: /create-character-pro-flash (8 directions, 32x32, high
//   top-down; s/n/e/w are kept) + template animations (1 generation per
//   direction each) for walk / idle / scan / jump frames.
// - target_palette: the class subset (subsetFor), narrowed by
//   PALETTE_HINTS for small sprites so the model cannot sprinkle unrelated
//   ramps (the first worker probe had green/purple strays); the local
//   quantize pass still maps every pixel into subsetFor(class).

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

/**
 * CITY_SUFFIX for sprites without a ground patch (the build-2 warehouse
 * exterior): no cast shadow on a ground that is not drawn.
 */
export const EXTERIOR_SUFFIX =
  ', 2:1 isometric pixel art, flat sunny daylight from the upper left, top ' +
  'faces lightest, left wall lighter than right wall, 1px dark outline, ' +
  'flat fills, saturated clean colours, strong readable silhouette, ' +
  'centred, transparent background, no text, no people, no vehicles, no ' +
  'grid lines, no anti-aliasing'

/**
 * Docks terminals (B2 §6.4) carry a reach-stacker / gantry, so the city
 * template's "no vehicles" would fight the subject.
 */
export const PORT_SUFFIX =
  ', 2:1 isometric pixel art, flat sunny daylight from the upper left, top ' +
  'faces lightest, left wall lighter than right wall, small sharp shadow, ' +
  '1px dark outline, flat fills, saturated clean colours, strong readable ' +
  'silhouette, centred, transparent background, no text, no people, no ' +
  'boats, no water, no grid lines, no anti-aliasing'

export const INTERIOR_SUFFIX =
  ', top-down 3/4 view from the front and slightly above, light from the ' +
  'top-left, chunky, bright, 1px dark outline, flat fills, saturated clean ' +
  'colours, centred, transparent background, no text, no anti-aliasing'

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

/** storeys for the prompt: district range, by footprint (§4.2) */
export function storeysFor(e: ManifestEntry): string {
  const d = e.district ?? ''
  const fp = e.footprint?.[0] ?? 1
  if (fp === 1 && (d === 'downtown' || d === 'highres')) return '2 to 3'
  if (fp === 3 && d === 'downtown') return '5 to 6'
  return STOREYS[d] ?? '2 to 3'
}

/**
 * Subjects that must differ from the manifest's `subject` because of a
 * geometry contract (the manifest stays the author-facing description).
 * metal_detector: the belt runs through the 24-px opening (x 12..35, rows
 * 16..47, warehouse-view §1.3), so the arch must be empty — the conveyor is
 * drawn by the belt tiles in-engine.
 */
export const SUBJECT_OVERRIDES: Record<string, string> = {
  metal_detector:
    'chunky security metal detector gate, two thick boxy pillars as wide ' +
    'as a hand, joined by a heavy crossbar header with a glowing light ' +
    'strip, bright blue and cream panels, the passage between the pillars ' +
    'is completely empty, nothing inside the gate',
  worker:
    'warehouse inspector in a bright yellow safety vest over a white shirt, ' +
    'blue trousers, brown cap, friendly, chunky proportions',
  // same opening contract as the metal detector (the belt runs through it)
  shaky_shaker:
    'chunky parcel shaker gate, two thick boxy pillars standing on big ' +
    'coil springs, joined by a heavy crossbar header with yellow and dark ' +
    'hazard stripes, orange and grey metal panels, the passage between the ' +
    'pillars is completely empty, nothing inside the gate',
  // shelf_t*: the mini parcels are drawn in-engine on the shelf boards
  // (warehouse.ts contract: area x 6..221, y 6..39), so the shelf is empty
  shelf_t1:
    'long low empty wooden warehouse storage shelf seen from above at a ' +
    'steep angle, its flat top of three long plank boards running left to ' +
    'right fills the whole picture, a short front face below, grey metal ' +
    'uprights at both ends and in the middle, nothing on the boards',
  shelf_t2:
    'long low empty painted steel warehouse storage shelf seen from ' +
    'above, three long empty light grey boards running left to right, ' +
    'bright blue uprights at both ends and in the middle, tidy, nothing on ' +
    'the boards',
  // build 2 (plan-build2 §6 Machines): same belt-opening contract as the
  // metal detector; the header's light strip is the idle/scan frame pair
  // (candidates.ts recolourStrip), so the colour accents live on the pillars
  battery_checker:
    'chunky battery checker gate, two thick boxy light grey pillars as ' +
    'wide as a hand, each with a tall green battery charge meter of ' +
    'stacked glowing cells on its front, joined by a heavy crossbar header ' +
    'with a glowing light strip and a big green battery shape lying on top, ' +
    'the passage between the pillars is completely empty, nothing inside ' +
    'the gate',
  // build 2 M9 re-roll (docs/art-todo.md M6 note: the M6 pick reads as an
  // arch): a long roof seen from above, a big screen with the x-ray picture
  // and a radiation sticker carry the "scanner" read; the passage below the
  // header stays empty (candidates.ts OPENINGS)
  xray:
    'chunky airport x-ray baggage scanner gate, two slim light grey pillars ' +
    'carrying a thick deep boxy roof block, on the front face of the roof ' +
    'block a wide dark blue screen showing a bright light blue x-ray ' +
    'outline of a parcel, a glowing light strip under the screen, a small ' +
    'yellow and black radiation warning sticker on the left pillar, purple ' +
    'trim, the space between the pillars under the roof block is completely ' +
    'empty and open down to the floor, nothing between the pillars',
  sorter_arm:
    'chunky industrial robot arm on a round grey pedestal base, an orange ' +
    'column, two thick yellow arm segments with grey joints raised up and ' +
    'bent at the elbow, a grey two-finger gripper claw at the end holding ' +
    'nothing, a small status lamp on the column',
  desk:
    'long wide wooden inspection desk seen from above, its rectangular ' +
    'desk top fills the whole picture, a grey parcel tray, a magnifying ' +
    'glass and a paper sheet on the desk top, chunky legs',
}

/**
 * Subjects describing several structures on one plot: the building
 * template's "a single chunky building" would fight them.
 */
export const GROUP_SUBJECTS = new Set([
  'dk_terminal_a',
  'dk_terminal_b',
  'dt_peer_plaza',
  'dt_transpile_campus',
  'ru_farm',
  'ru_orchard',
  'dk_pier',
  'in_glob_silos',
  'in_rimraf_yard',
  'dk_containers',
  'cv_stadium',
  // build 2 M7 (B2 §6.5): the Rural uniques drawn as a yard of several parts
  'ru_peer_pasture',
  'ru_range_ranch',
  'ru_optional_orchard',
])

/**
 * Buildings whose one unique feature is a farm machine (build 2 M7, B2 §6.5:
 * the tractor in Tilde Tractor Repair): CITY_SUFFIX without its 'no
 * vehicles' (it keeps road vehicles off the other plots).
 */
export const VEHICLE_OK = new Set([
  'ru_tilde_tractors',
  // build 2 M8 (L5 civic): the fire engine in the open bay; the Airport's
  // parked jet is itself the subject (a dock-prop)
  'cv_fire',
  'ap_plane',
])

/**
 * dock-prop headings (the template's default is "bow pointing to the lower
 * left"): the plane taxis east along +x, off the east edge (B2 §4.3,
 * design-m8-m9 §1.2 `exit [4, 0]`) — nose to the lower right; the ship
 * sails west along -x (`exit [-5, 0]`) — bow to the upper left.
 */
export const DOCK_PROP_HEADING: Record<string, string> = {
  ap_plane: 'nose pointing to the lower right',
  // build 2 M9 re-roll: the ship leaves west along -x (map.hubs exit
  // [-5, 0]), i.e. toward the upper left of the screen, so the bow points
  // there and the departure tween sails it bow first (the M5 pick's bow
  // points to the lower left, so it slid sideways)
  dk_ship:
    'bow pointing to the upper left, the stern with the white bridge tower ' +
    'at the lower right nearest the viewer, the long hull running from the ' +
    'lower right to the upper left',
}

/** the build-2 modern port rows (B2 §6.4) */
export const PORT_IDS = new Set([
  'dk_terminal_a',
  'dk_terminal_b',
  'dk_port_office',
])

/** the plot wording per district (the ground patch the model paints) */
export const YARD: Record<string, string> = {
  downtown: 'small paved yard',
  highres: 'small paved yard',
  industrial: 'concrete yard',
  docks: 'concrete quay',
  airport: 'concrete apron',
  civic: 'small lawn with hedges',
  lowres: 'small garden lawn',
  rural: 'grassy yard',
}

/**
 * The approved building anchor whose look a district borrows as Pro Flash
 * style_image (closest material / ground): the city stays one style.
 */
export const DISTRICT_ANCHOR: Record<string, string> = {
  downtown: 'dt_scope_offices',
  highres: 'hr_async_arms',
  lowres: 'hr_async_arms',
  industrial: 'in_esbuild_engines',
  docks: 'in_esbuild_engines',
  airport: 'in_esbuild_engines',
  warehouse: 'in_esbuild_engines',
  // build 2 M8: cv_civic_2x2 (the playtest-1 civic anchor) was retired for
  // the ten civic uniques; its districts borrow the residential anchor
  civic: 'hr_async_arms',
  rural: 'hr_async_arms',
  map: 'hr_async_arms',
}

/** narrower target palettes (ramps) for small sprites, by id or class */
export const PALETTE_HINTS: Record<string, string[]> = {
  worker: ['outline', 'grey', 'skin', 'yellow', 'blue', 'brown'],
  'vehicle-van': ['outline', 'grey', 'yellow', 'orange'],
  // build 2: the courier (skin, white helmet = grey5, blue shirt)
  'vehicle-bike': ['outline', 'grey', 'yellow', 'blue', 'skin', 'brown'],
  'vehicle-truck': ['outline', 'grey', 'blue', 'orange'],
  machine: ['outline', 'grey', 'blue', 'yellow', 'grass'],
  shaky_shaker: ['outline', 'grey', 'orange', 'yellow', 'blue'],
  battery_checker: ['outline', 'grey', 'grass', 'yellow', 'blue'],
  xray: ['outline', 'grey', 'blue', 'purple', 'yellow'],
  sorter_arm: ['outline', 'grey', 'orange', 'yellow', 'blue'],
  desk: ['outline', 'grey', 'brown', 'blue'],
  shelf_t1: ['outline', 'grey', 'brown'],
  shelf_t2: ['outline', 'grey', 'blue'],
}

/**
 * worker frames from template animations (1 generation per direction).
 * Template ids are not in the OpenAPI enum; the complete humanoid list (and
 * frame counts) is in the MCP animate_character schema: breathing-idle (4),
 * walking-4-frames (4), picking-up (5), two-footed-jump (7), … — `pick-up`
 * and `jumping` (from the docs search) are refused with a 422.
 */
export const WORKER_ANIMATIONS: { key: string; template: string }[] = [
  { key: 'walk', template: 'walking-4-frames' },
  { key: 'idle', template: 'breathing-idle' },
  { key: 'scan', template: 'picking-up' },
  { key: 'jump', template: 'two-footed-jump' },
]
export const WORKER_DIRECTIONS = ['south', 'north', 'east', 'west'] as const

/** enum values the presets use, per endpoint + request property */
export const PRESET_ENUMS: { endpoint: string; prop: string; value: string }[] =
  [
    {
      endpoint: '/create-object-pro-flash',
      prop: 'view',
      value: 'low top-down',
    },
    {
      endpoint: '/create-character-pro-flash',
      prop: 'view',
      value: 'high top-down',
    },
    {
      endpoint: '/create-8-direction-object',
      prop: 'view',
      value: 'low top-down',
    },
    { endpoint: '/map-objects', prop: 'view', value: 'high top-down' },
    {
      endpoint: '/map-objects',
      prop: 'outline',
      value: 'single color outline',
    },
    { endpoint: '/map-objects', prop: 'shading', value: 'medium shading' },
    { endpoint: '/map-objects', prop: 'detail', value: 'medium detail' },
    { endpoint: '/animate-character', prop: 'mode', value: 'template' },
  ]

export type Recipe = 'image' | 'object8' | 'character'

export interface Prompt {
  /** tool name logged in gen[].tool */
  tool: string
  /** REST v2 path */
  endpoint: string
  /** how gen.ts turns the job into candidate frames */
  recipe: Recipe
  text: string
  /** request body without images (logged verbatim) */
  params: Record<string, unknown>
  /** images attached at call time (not logged as data) */
  attach: (
    | 'style_anchors'
    | 'style_anchor_fit'
    | 'palette_png'
    | 'floor_tile'
    | 'style_object'
    | 'edit_source'
  )[]
  /** generations per call (budget estimate, §3.6; /pro-flash/cost) */
  cost: number
  /** candidates one call returns */
  perCall: number
  /** follow-up template animations (worker), 1 generation per direction */
  animations?: { key: string; template: string; directions: string[] }[]
  /** follow-up edit (warehouse exterior _t2 = edit of the chosen _t1) */
  followUp?: { endpoint: string; frame: string; description: string }
  /** id of the anchor attached as style_image (style_anchor_fit) */
  styleAnchor?: string
  /** edit recipe: the id whose chosen candidate is the edit source */
  editOf?: string
}

/**
 * Entries generated as an edit of another entry's chosen candidate (tier 2
 * art keeps the tier 1 geometry: same boards, same mini-parcel area).
 */
export const EDIT_OF: Record<string, { source: string; description: string }> =
  {
    // build 2 M7 (B2 §6.6): tier 4 keeps tier 3's footprint and bays
    wh_ext_t4: {
      source: 'wh_ext_t3',
      description:
        'repaint as a big modern steel distribution centre: light grey and ' +
        'blue steel cladding instead of the brick, add a third loading dock ' +
        'door with its own small amber lamp in the row next to the two ' +
        'doors on the left wall, add a big plain blue and yellow company ' +
        'logo board without any text on the roof edge above the doors, keep ' +
        'exactly the same building shape, base corners and camera angle, ' +
        'no ground',
    },
    shelf_t2: {
      source: 'shelf_t1',
      description:
        'repaint as a tidy tier 2 shelf: bright blue painted steel uprights, ' +
        'light grey painted boards, clean, keep exactly the same shape, size, ' +
        'boards and camera angle, nothing on the boards',
    },
  }

export type StyleMode = 'auto' | 'none' | 'anchor' | 'v2'

export interface StyleAnchor {
  id: string
  w: number
  h: number
}

export interface PromptCtx {
  /** the approved building style anchors available (ids + sizes) */
  anchors?: StyleAnchor[]
  /**
   * building style source: 'none' = Pro Flash text only (as the anchors
   * were made); 'anchor' = Pro Flash with the district's anchor as
   * style_image (must fit the canvas); 'v2' = /generate-with-style-v2 with
   * all anchors (square output of the largest anchor side, 4 per call);
   * 'auto' = 'none' (bulk pass decision, 2026-10-29: both style routes
   * copy the anchor's structure — Pro Flash style_image redrew
   * hr_async_arms in yellow for hr_promise_place, style-v2 returned the 4
   * anchors recoloured — so every building would be an anchor clone,
   * against §1.3 rule 4; coherence comes from the frozen template, the
   * palette and the anchors' canvas sizes, checked in context).
   */
  style?: StyleMode
  /** force / forbid the solid key background (default: wantsKey) */
  key?: boolean
  /** bike / truck tool: 'object8' (style object = van) or 'proflash' */
  vehicle?: 'object8' | 'proflash'
  /** use FALLBACK_SUBJECTS (B2 §6.2: after three failed bicycle rounds) */
  fallback?: boolean
}

/**
 * Fallback subjects (gen --fallback): B2 §6.2 — if three rounds of the
 * bicycle fail lint, the scooter comes back, but never riderless.
 */
export const FALLBACK_SUBJECTS: Record<string, string> = {
  bike: 'orange delivery scooter with a rider wearing a white helmet',
}

/** the anchor a target borrows its look from (district match, must fit) */
export function anchorFor(
  e: ManifestEntry,
  anchors: StyleAnchor[],
): StyleAnchor | null {
  const [W, H] = e.canvas
  const fits = anchors.filter((a) => a.w <= W && a.h <= H)
  const want = DISTRICT_ANCHOR[e.district ?? ''] ?? 'dt_scope_offices'
  return fits.find((a) => a.id === want) ?? fits[0] ?? null
}

/** palette hexes allowed for the entry's class (target_palette.colors) */
export function paletteColors(e: ManifestEntry): string[] {
  const subset = subsetFor(e.class, { district: e.district })
  const hint = PALETTE_HINTS[e.id] ?? PALETTE_HINTS[e.class]
  const ramps = new Set([
    ...(hint ?? []),
    ...(e.bodyRamp && hint ? [e.bodyRamp] : []),
  ])
  const chosen = hint ? subset.filter((c) => ramps.has(c.ramp)) : subset
  return chosen.map((c) => c.hex)
}

export function palettePngBase64(): string {
  return readFileSync(PALETTE_PNG).toString('base64')
}

export const FLOOR_TILE_PNG = join(
  ROOT,
  'art/final/interior-tile/floor_t1_0.png',
)

/** Pro Flash create cost in generations by longest side (5 / 6 / 9) */
export function proFlashCost(w: number, h: number): number {
  const s = Math.max(w, h)
  return s <= 96 ? 5 : s <= 160 ? 6 : 9
}

/** Pro Flash sizes are multiples of 4 in 16..256 */
function pfSize(n: number): number {
  return Math.min(256, Math.max(16, Math.ceil(n / 4) * 4))
}

/** the key colour of a solid background (not a palette colour) */
export const BG_KEY = '#ff00ff'

/**
 * Pro Flash draws transparent-background sprites at its native scale
 * (<= 128 px) and centres them on a larger custom canvas (G2 bulk probe:
 * 3x3 towers came out ~125 px wide on the 192-px plot); an image *with* a
 * background must fill the canvas. Canvases wider than 128 px therefore ask
 * for a solid magenta background, which candidates.ts keys out.
 */
export function wantsKey(e: ManifestEntry): boolean {
  if (e.class === 'fixture-desk' || e.class === 'fixture-shelf') return true
  return (
    e.canvas[0] > 160 &&
    (e.class.startsWith('building') || e.class === 'warehouse-ext')
  )
}

function proFlashImage(
  e: ManifestEntry,
  text0: string,
  attach: Prompt['attach'],
  styleAnchor: StyleAnchor | null = null,
  key = false,
): Prompt {
  const [W, H] = e.canvas
  const w = pfSize(W)
  const h = pfSize(H)
  // the model paints "magenta" as a dusty pink (#d1457d): subjects that
  // ask for pink get a cyan key instead
  const keyWord = /pink/.test(text0) ? 'cyan' : 'magenta'
  const text = key
    ? text0.replace(
        'transparent background',
        `the whole picture on a plain solid flat ${keyWord} background`,
      )
    : text0
  const colors = paletteColors(e)
  return {
    tool: 'create-image-pro-flash',
    endpoint: '/create-image-pro-flash',
    recipe: 'image',
    text,
    params: {
      description: text,
      image_size: { width: w, height: h },
      no_background: !key,
      target_palette: {
        colors: key
          ? [...colors, keyWord === 'cyan' ? '#00ffff' : BG_KEY]
          : colors,
        max_colors: key ? 21 : 20,
      },
    },
    attach: styleAnchor ? [...attach, 'style_anchor_fit'] : attach,
    styleAnchor: styleAnchor?.id,
    cost: proFlashCost(w, h),
    perCall: 1,
  }
}

/** an EDIT_OF row: edit-image-pro-flash on the source's chosen candidate */
function editPrompt(
  e: ManifestEntry,
  ed: { source: string; description: string },
): Prompt {
  const [W, H] = e.canvas
  return {
    tool: 'edit-image-pro-flash',
    endpoint: '/edit-image-pro-flash',
    recipe: 'image',
    text: ed.description,
    params: {
      method: 'text',
      description: ed.description,
      no_background: true,
    },
    attach: ['edit_source'],
    editOf: ed.source,
    cost: proFlashCost(W, H) === 5 ? 5 : 9,
    perCall: 1,
  }
}

/**
 * The warehouse exterior's footprint sentence (B2 §6.1): the walls' base
 * fills the 4x4 diamond, the front corner on the canvas bottom centre.
 */
const EXTERIOR_BASE =
  'seen from a 2:1 isometric angle, its rectangular base fills the whole ' +
  '256x128 isometric diamond footprint: the front corner of the walls ' +
  'touches the bottom centre of the picture and the left and right corners ' +
  'of the walls touch the left and right edges of the picture'

/** tier 1 (the wh_ext row; its _t2 is the followUp edit) */
const EXTERIOR_T1 =
  `corrugated tin delivery warehouse building ${EXTERIOR_BASE}, a row ` +
  'of three loading dock doors on the left (south-west) wall near its ' +
  'far end, the first door open and two shuttered, a small amber lamp ' +
  'above each door, low pitched roof, small office annex built into ' +
  'the front corner, scrappy start-up look'

/**
 * Tiers 3 and 5 (build 2 M7, B2 §6.6 / spec §8: L3 brick with 2 bays, L5
 * glass HQ with a neon sign); tier 4 is EDIT_OF wh_ext_t3. The bays stay at
 * the far end of the south-west wall, each with its amber lamp (the city
 * hangs the bay lights there: manifest bayLights).
 */
export const EXTERIOR_SUBJECTS: Record<string, string> = {
  wh_ext_t3:
    `red-orange brick regional parcel depot building ${EXTERIOR_BASE}, ` +
    'two big open loading dock doors side by side on the left ' +
    '(south-west) wall near its far end, a small amber lamp above each ' +
    'door, a flat roof with a low parapet, rooftop vents and a water tank, ' +
    'a two-storey brick office block with tall white-framed windows built ' +
    'into the front corner, solid established family business look',
  wh_ext_t5:
    `gleaming glass and white steel company headquarters building ${EXTERIOR_BASE}, ` +
    'three loading dock doors in a row on the left (south-west) wall near ' +
    'its far end, a small amber lamp above each door, a tall blue glass ' +
    'office tower three storeys high at the front corner, a big glowing ' +
    'pink and purple neon sign shaped like a parcel box on the tower roof ' +
    'without any letters, rooftop garden with small trees, proud tycoon ' +
    'look',
}

export function promptFor(e: ManifestEntry, ctx: PromptCtx = {}): Prompt {
  const [W, H] = e.canvas
  const subject =
    SUBJECT_OVERRIDES[e.id] ?? e.subject ?? e.id.replace(/_/g, ' ')
  const target_palette = { colors: paletteColors(e), max_colors: 20 }
  const anchors = ctx.anchors ?? []
  switch (e.class) {
    case 'building1x1':
    case 'building2x2':
    case 'building3x3': {
      const fw = 64 * (e.footprint?.[0] ?? 1)
      const what = GROUP_SUBJECTS.has(e.id)
        ? 'a chunky group of buildings that fills most of a'
        : 'a single chunky building whose walls fill most of a'
      // industrial chimneys: the game emits fx_smoke at smokeAnchors, so
      // baked smoke (bulk pass: on 9 of 15 industrial 3x3 candidates)
      // would double it and stay on while the region is locked
      const smoke =
        e.district === 'industrial'
          ? ', chimneys without any smoke or steam'
          : ''
      // build 2 port (B2 §6.4): modern, 'no vehicles' lifted (the
      // reach-stacker), no water on the plot (they stand on the quay land)
      const port = PORT_IDS.has(e.id)
      const text = port
        ? `${subject}, ${what} ${fw}x${fw / 2} isometric diamond plot, ` +
          `${YARD[e.district ?? ''] ?? 'small paved yard'}, modern ` +
          `2020s harbour logistics, steel and glass, bright cheerful ` +
          `city-builder style${PORT_SUFFIX}`
        : `${subject}${smoke}, ${what} ${fw}x${fw / 2} isometric diamond plot, ` +
          `${YARD[e.district ?? ''] ?? 'small paved yard'}, ` +
          `${storeysFor(e)} storeys, bright cheerful ` +
          `city-builder style${
            VEHICLE_OK.has(e.id)
              ? CITY_SUFFIX.replace('no vehicles, ', '')
              : CITY_SUFFIX
          }`
      const side = Math.max(W, H)
      const style = ctx.style ?? 'auto'
      if (
        style === 'v2' &&
        anchors.length > 0 &&
        side <= 170 &&
        anchors.every((a) => Math.max(a.w, a.h) === side)
      ) {
        return {
          tool: 'generate-with-style-v2',
          endpoint: '/generate-with-style-v2',
          recipe: 'image',
          text,
          params: { description: text, no_background: true, target_palette },
          attach: ['style_anchors'],
          cost: side <= 96 ? 10 : 15,
          perCall: 4,
        }
      }
      const anchor = style === 'anchor' ? anchorFor(e, anchors) : null
      return proFlashImage(e, text, [], anchor, ctx.key ?? wantsKey(e))
    }
    case 'warehouse-ext': {
      // v3 (build 2, F2 / B2 §6.1): no apron. v2 ('standing in the middle
      // of a 256x128 isometric diamond concrete lot') drew its own lot,
      // never on the grid; the slab is now ground-bake tiles (lot_slab),
      // so the walls must stand on the 4x4 footprint diamond itself.
      // Tiers 3-5 (build 2 M7, B2 §6.6): wh_ext_t3 / _t5 are their own
      // rows with the same footprint sentence; wh_ext_t4 is an edit of the
      // chosen wh_ext_t3 (EDIT_OF), like t2 of t1.
      const ed = EDIT_OF[e.id]
      if (ed) return editPrompt(e, ed)
      const text =
        (EXTERIOR_SUBJECTS[e.id] ?? EXTERIOR_T1) +
        ', no ground, no pavement, no lot, no apron, no shadow outside the ' +
        'walls, nothing below the walls' +
        EXTERIOR_SUFFIX
      const anchor = ctx.style === 'anchor' ? anchorFor(e, anchors) : null
      const p = proFlashImage(e, text, [], anchor, ctx.key ?? wantsKey(e))
      if (e.id !== 'wh_ext') return p
      return {
        ...p,
        followUp: {
          endpoint: '/edit-image-pro-flash',
          frame: '_t2',
          description:
            'repaint the corrugated walls bright blue with cream trim, add a ' +
            'plain yellow company sign board without any text over the ' +
            'loading doors, cleaner light grey roof, keep exactly the same ' +
            'building shape, base corners, doors and camera angle, no ground',
        },
      }
    }
    case 'prop':
    case 'dock-prop': {
      const suffix = VEHICLE_OK.has(e.id)
        ? CITY_SUFFIX.replace('no vehicles, ', '')
        : CITY_SUFFIX
      const text =
        e.class === 'dock-prop'
          ? `${subject}, seen from a 2:1 isometric angle, ` +
            `${DOCK_PROP_HEADING[e.id] ?? 'bow pointing to the lower left'}, ` +
            `isometric pixel art prop${suffix}`
          : `${subject}, a single standalone object standing on the ground, ` +
            `isometric pixel art prop${suffix}`
      const anchor = ctx.style === 'anchor' ? anchorFor(e, anchors) : null
      return proFlashImage(e, text, [], anchor)
    }
    case 'vehicle-bike':
    case 'vehicle-van':
    case 'vehicle-truck': {
      // bike (build 2, F3): the courier rides it — a person is the point
      const colour =
        e.class === 'vehicle-bike'
          ? `, the rider sits upright on the saddle with hands on the handlebar, two thin wheels, narrow side profile, the rider's white helmet clearly visible`
          : e.class === 'vehicle-truck'
            ? `, bright ${e.bodyRamp ?? 'yellow'} long cargo box and a ${e.bodyRamp === 'yellow' ? 'light blue' : 'white'} cab with a lighter roof`
            : e.bodyRamp
              ? `, bright light ${e.bodyRamp} body with a lighter roof`
              : ''
      const subj =
        e.class === 'vehicle-bike' && ctx.fallback
          ? (FALLBACK_SUBJECTS[e.id] ?? subject)
          : subject
      const text =
        `${subj}${colour}, small delivery vehicle, toy-like proportions, ` +
        'simple clean shapes, 1px dark outline, flat fills, no text, no logo'
      // bike: the van style object cannot be used (its content is 27x23,
      // the bike canvas 24x24 — /create-8-direction-object fails fast with
      // "Increase the output size to at least 27x23"), so the bike uses the
      // van's own tool and template; the truck may too (--vehicle proflash)
      const viaProFlash =
        e.class === 'vehicle-van' ||
        (ctx.vehicle ??
          (e.class === 'vehicle-bike' ? 'proflash' : 'object8')) === 'proflash'
      if (viaProFlash) {
        // bike 28 on the 32x32 canvas (build 2): the model draws about as
        // tall as the requested size (playtest 1: 24 -> 24-px sprites that
        // broke the 1-px margin of a 24x24 canvas), so 28 keeps rows 1..30
        const side =
          e.class === 'vehicle-bike'
            ? 28
            : e.class === 'vehicle-truck'
              ? 40
              : 32
        return {
          tool: 'create-object-pro-flash',
          endpoint: '/create-object-pro-flash',
          recipe: 'object8',
          text,
          params: {
            description: text,
            n_directions: 8,
            view: 'low top-down',
            image_size: { width: side, height: side },
            target_palette,
          },
          attach: [],
          cost: 6,
          perCall: 1,
        }
      }
      return {
        tool: 'create-8-direction-object',
        endpoint: '/create-8-direction-object',
        recipe: 'object8',
        text,
        params: {
          description: text,
          size: e.class === 'vehicle-bike' ? 24 : 48,
          view: 'low top-down',
          target_palette,
        },
        attach: ['style_object'],
        cost: 10,
        perCall: 1,
      }
    }
    case 'worker': {
      const text = `${subject}, 1px dark outline, flat fills`
      return {
        tool: 'create-character-pro-flash',
        endpoint: '/create-character-pro-flash',
        recipe: 'character',
        text,
        params: {
          description: text,
          image_size: { width: 32, height: 32 },
          view: 'high top-down',
          n_directions: 8,
          target_palette: { colors: paletteColors(e), max_colors: 16 },
        },
        attach: [],
        cost: 6 + WORKER_ANIMATIONS.length * WORKER_DIRECTIONS.length,
        perCall: 1,
        animations: WORKER_ANIMATIONS.map((a) => ({
          ...a,
          directions: [...WORKER_DIRECTIONS],
        })),
      }
    }
    default: {
      const ed = EDIT_OF[e.id]
      if (ed) return editPrompt(e, ed)
      // machines, fixtures, desk, shelves: Pro Flash at the class canvas;
      // desk / shelf ask for the key background so they fill their canvas
      // (transparent ones drew a 26-px desk, a 158-px shelf)
      const text = `${subject}, warehouse equipment${INTERIOR_SUFFIX}`
      return proFlashImage(e, text, [], null, ctx.key ?? wantsKey(e))
    }
  }
}
