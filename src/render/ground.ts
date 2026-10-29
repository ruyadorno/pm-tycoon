// Ground bake (city-view.md §1.2, §1.4; phaser4-notes.md §2, §8): every tile
// of the 48x48 map stamped into ONE DynamicTexture('ground', 3072, 1536), one
// Image at depth -1. Per tile, in order: the base frame (map.json ground rules
// via groundAt; `_locked` inside a locked region's blocks), the road autotile
// `road_<mask>` from the trimmed avenue set (+ the themed one-sided edge
// overlays), then the 2-px district kerb along every block edge that faces a
// road or the map edge, tinted with the region's palette colour. Re-baked on
// RESTORE_WEBGL (DynamicTexture contents die with the context) and on demand
// (region unlock).
import Phaser from 'phaser'
import {
  groundAt,
  isRoadTile,
  mapBlockAt,
  roadThemesAt,
  type MapData,
} from '../data/index.ts'
import { PALETTE, paletteColour } from '../ui/theme.ts'
import { GROUND_H, GROUND_TEXTURE, GROUND_W, WORLD_ATLAS } from './atlases.ts'
import { HH, HW, originX, tileTopLeft } from './iso.ts'

/**
 * Road autotile mask bits, 4-bit NESW in tile space (style-guide.md §7:
 * `road_05`, zero-padded decimal). Iso directions: N = -ty (the diamond's
 * upper-right edge), E = +tx (lower-right), S = +ty (lower-left), W = -tx
 * (upper-left) — the same mapping as the vehicle headings (+tx = se).
 */
export const ROAD_N = 1
export const ROAD_E = 2
export const ROAD_S = 4
export const ROAD_W = 8

/** Neighbour offsets in NESW order, matching ROAD_N..ROAD_W and kerb_n/e/s/w. */
export const NESW: readonly (readonly [number, number, string])[] = [
  [0, -1, 'n'],
  [1, 0, 'e'],
  [0, 1, 's'],
  [-1, 0, 'w'],
]

/** Kerb tint inside a locked region: the fog grey (spec §3.5). */
const LOCKED_KERB_TINT = PALETTE.grey4

/** World y of the ground image's top edge: tile (0,0)'s top vertex. */
export const GROUND_Y = -HH

export function roadMask(map: MapData, x: number, y: number): number {
  let m = 0
  if (isRoadTile(map, x, y - 1)) m |= ROAD_N
  if (isRoadTile(map, x + 1, y)) m |= ROAD_E
  if (isRoadTile(map, x, y + 1)) m |= ROAD_S
  if (isRoadTile(map, x - 1, y)) m |= ROAD_W
  return m
}

export const roadFrameName = (mask: number): string =>
  `road_${String(mask).padStart(2, '0')}`

export interface GroundBakeOptions {
  /** True while the region (district id, 'warehouse', scenery) is fogged. */
  isLocked?: (regionId: string) => boolean
  /** Texture key; default 'ground' (a second key for the unlock crossfade). */
  key?: string
  /** Depth of the Image; default -1. */
  depth?: number
}

export interface GroundBake {
  readonly image: Phaser.GameObjects.Image
  readonly texture: Phaser.Textures.DynamicTexture
  /** Frame stems the atlas lacked (stamped with a fallback); empty when complete. */
  readonly missing: ReadonlySet<string>
  /** Stamps per bake (for the overlay / tests). */
  readonly stamps: number
  rebake(isLocked?: (regionId: string) => boolean): void
  destroy(): void
}

/** Resolve a ground stem to an atlas frame: `stem_locked`, `stem`, `stem_f0`. */
function resolver(
  scene: Phaser.Scene,
  missing: Set<string>,
): (stem: string, locked: boolean) => string | null {
  const tex = scene.textures.get(WORLD_ATLAS)
  const cache = new Map<string, string | null>()
  return (stem, locked) => {
    const k = `${stem}|${locked ? 1 : 0}`
    const hit = cache.get(k)
    if (hit !== undefined) return hit
    const tries = locked
      ? [`${stem}_locked`, `${stem}_f0_locked`, stem, `${stem}_f0`]
      : [stem, `${stem}_f0`]
    let found: string | null = null
    for (const t of tries)
      if (tex.has(t)) {
        found = t
        break
      }
    if (!found) missing.add(locked ? `${stem}_locked` : stem)
    cache.set(k, found)
    return found
  }
}

export function bakeGround(
  scene: Phaser.Scene,
  map: MapData,
  opts: GroundBakeOptions = {},
): GroundBake {
  const key = opts.key ?? GROUND_TEXTURE
  const [mapW, mapH] = map.size
  const ox = originX(mapH)
  const texW = (mapW + mapH) * HW
  const texH = (mapW + mapH) * HH
  if (texW !== GROUND_W || texH !== GROUND_H)
    console.warn(`ground: ${texW}x${texH} differs from ${GROUND_W}x${GROUND_H}`)

  const created = scene.textures.exists(key)
    ? (scene.textures.get(key) as Phaser.Textures.DynamicTexture)
    : scene.textures.addDynamicTexture(key, texW, texH)
  if (!created) throw new Error(`ground: cannot create DynamicTexture "${key}"`)
  let dt: Phaser.Textures.DynamicTexture = created

  const regionColour = new Map<string, number>()
  for (const r of map.regions) regionColour.set(r.id, paletteColour(r.colour))

  const missing = new Set<string>()
  let isLocked = opts.isLocked ?? (() => false)
  let stamps = 0

  const draw = (): void => {
    missing.clear()
    stamps = 0
    const frame = resolver(scene, missing)
    const fallback = frame('grass', false)
    const at = { x: 0, y: 0 }
    dt.clear()
    const stamp = (
      f: string | null,
      x: number,
      y: number,
      tint?: number,
    ): void => {
      const name = f ?? fallback
      if (!name) return
      tileTopLeft(x, y, ox, at)
      dt.stamp(WORLD_ATLAS, name, at.x, at.y - GROUND_Y, {
        originX: 0,
        originY: 0,
        ...(tint === undefined ? {} : { tint }),
      })
      stamps++
    }
    // Row-major in tile space; tiles never overlap (each stamp is its own
    // 64x32 diamond), so the order only matters within a tile.
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const block = mapBlockAt(map, x, y)
        const locked =
          block !== null && block.kind === 'region' && isLocked(block.region)
        stamp(frame(groundAt(map, x, y), locked), x, y)
        if (isRoadTile(map, x, y)) {
          stamp(frame(roadFrameName(roadMask(map, x, y)), false), x, y)
          for (const t of roadThemesAt(map, x, y))
            stamp(frame(t.frame, false), x, y)
          continue
        }
        if (!block || block.kind === 'scenery') continue
        // Kerb on every edge leaving this block (towards a road or the edge).
        const tint = locked
          ? LOCKED_KERB_TINT
          : (regionColour.get(block.region) ?? PALETTE.grey3)
        for (const [dx, dy, dir] of NESW) {
          const nb = mapBlockAt(map, x + dx, y + dy)
          if (
            nb &&
            nb.block[0] === block.block[0] &&
            nb.block[1] === block.block[1]
          )
            continue
          const kerb = frame(`kerb_${dir}`, false)
          if (kerb) stamp(kerb, x, y, tint)
        }
      }
    }
    dt.render()
    if (missing.size > 0)
      console.warn(`ground: atlas lacks ${[...missing].toSorted().join(', ')}`)
  }

  draw()
  const image = scene.add
    .image(0, GROUND_Y, key)
    .setOrigin(0, 0)
    .setDepth(opts.depth ?? -1)

  const renderer = scene.game.renderer
  const onRestore = (): void => {
    if (scene.textures.exists(key)) draw()
  }
  renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, onRestore)
  const onShutdown = (): void => {
    renderer.off(Phaser.Renderer.Events.RESTORE_WEBGL, onRestore)
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown)

  return {
    image,
    get texture() {
      return dt
    },
    missing,
    get stamps() {
      return stamps
    },
    rebake(next) {
      if (next) isLocked = next
      dt = scene.textures.get(key) as Phaser.Textures.DynamicTexture
      draw()
    },
    destroy() {
      onShutdown()
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown)
      image.destroy()
      if (scene.textures.exists(key)) scene.textures.remove(key)
    },
  }
}
