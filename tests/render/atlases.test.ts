// Two atlases + hashed asset sources (spec-build2 §6.8, plan-build2 §8.2
// task 8, report-playtest1 §6.21): src/assets/{world,interior}.json agree
// with frames.generated.ts (FRAME_ATLAS + SHARED_FRAMES), each is one
// power-of-two page <= 2048², `world` stays <= 75 % full, the HUD-drawn
// frames live in `world`, the room-only art in `interior`, and the room's
// atlas choice (roomAtlas) prefers `interior`.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ATLAS_KEYS,
  ATTRACT_KEY,
  INTERIOR_ATLAS,
  LOGO_KEY,
  UI_ATLAS,
  WAREHOUSE_ATLAS,
  WORLD_ATLAS,
} from '../../src/render/atlases.ts'
import {
  FRAME_ATLAS,
  FRAMES,
  SHARED_FRAMES,
  atlasOf,
  inAtlas,
  roomAtlas,
  type FrameName,
} from '../../src/render/frames.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

interface AtlasJson {
  textures: {
    image: string
    size: { w: number; h: number }
    frames: { filename: string; frame: { w: number; h: number } }[]
  }[]
}

function readAtlas(key: string): AtlasJson {
  return JSON.parse(
    readFileSync(`${root}src/assets/${key}.json`, 'utf8'),
  ) as AtlasJson
}

const pow2 = (n: number): boolean => n > 0 && (n & (n - 1)) === 0
const names = Object.keys(FRAMES) as FrameName[]

describe('atlas keys', () => {
  it('world for the city/HUD, interior for the warehouse room', () => {
    expect(WORLD_ATLAS).toBe('world')
    expect(INTERIOR_ATLAS).toBe('interior')
    expect(UI_ATLAS).toBe(WORLD_ATLAS)
    expect(WAREHOUSE_ATLAS).toBe(INTERIOR_ATLAS)
    expect([...ATLAS_KEYS]).toEqual(['world', 'interior'])
    expect(LOGO_KEY).toBe('logo')
    expect(ATTRACT_KEY).toBe('attract')
  })
})

describe('src/assets atlases', () => {
  it('the hashed-asset sources exist and public/assets is gone', () => {
    for (const f of [
      'world.png',
      'world.json',
      'interior.png',
      'interior.json',
      'm5x7.xml',
      'logo.png',
      'attract.json',
    ]) {
      expect(existsSync(`${root}src/assets/${f}`), f).toBe(true)
    }
    expect(existsSync(`${root}public/assets`)).toBe(false)
  })

  for (const key of ATLAS_KEYS) {
    it(`${key}: one power-of-two page <= 2048², named ${key}.png`, () => {
      const a = readAtlas(key)
      expect(a.textures).toHaveLength(1)
      const t = a.textures[0]!
      expect(t.image).toBe(`${key}.png`)
      expect(pow2(t.size.w) && pow2(t.size.h)).toBe(true)
      expect(t.size.w).toBeLessThanOrEqual(2048)
      expect(t.size.h).toBeLessThanOrEqual(2048)
      const seen = new Set<string>()
      for (const f of t.frames) {
        expect(seen.has(f.filename), f.filename).toBe(false)
        seen.add(f.filename)
      }
    })
  }

  it('frames.generated.ts matches the packed frames (FRAME_ATLAS + SHARED_FRAMES)', () => {
    const world = new Set(
      readAtlas('world').textures[0]!.frames.map((f) => f.filename),
    )
    const interior = new Set(
      readAtlas('interior').textures[0]!.frames.map((f) => f.filename),
    )
    for (const n of names) {
      const shared = SHARED_FRAMES.has(n)
      expect(world.has(n), `${n} in world`).toBe(FRAME_ATLAS[n] === 'world')
      expect(interior.has(n), `${n} in interior`).toBe(
        FRAME_ATLAS[n] === 'interior' || shared,
      )
      if (shared) expect(FRAME_ATLAS[n], n).toBe('world')
    }
    for (const n of [...world, ...interior]) {
      expect(n in FRAMES, `${n} reachable through FRAMES`).toBe(true)
    }
  })

  it('world stays <= 75 % full (plan-build2 §8.2 acceptance)', () => {
    const t = readAtlas('world').textures[0]!
    const area = t.frames.reduce((n, f) => n + f.frame.w * f.frame.h, 0)
    expect(area / (t.size.w * t.size.h)).toBeLessThanOrEqual(0.75)
  })
})

describe('atlas assignment (who binds what)', () => {
  it('nine-slices, city art and vehicles are world-only; m5x7 is in both (ROOM_FONT_KEY)', () => {
    for (const n of ['ui_panel', 'ui_panel_dark', 'ui_banner', 'grass']) {
      if (!(n in FRAMES)) continue
      expect(FRAME_ATLAS[n as FrameName], n).toBe('world')
      expect(inAtlas(n, 'interior'), n).toBe(false)
    }
    expect(FRAME_ATLAS.m5x7).toBe('world')
    expect(inAtlas('m5x7', 'interior')).toBe(true)
    for (const n of names) {
      if (
        /^(bike|van|truck)_(ne|nw|se|sw)_\d$/.test(n) ||
        /^road_\d\d$/.test(n)
      ) {
        expect(FRAME_ATLAS[n], n).toBe('world')
        expect(SHARED_FRAMES.has(n), n).toBe(false)
      }
    }
  })

  it('room art the room draws in a front layer (badges) is in world', () => {
    for (const n of names) {
      if (/^(ext_outline|slot_(empty|locked)_outline|lamp_)/.test(n)) {
        expect(inAtlas(n, 'world'), n).toBe(true)
        expect(atlasOf(n), n).toBe('world')
      }
    }
  })

  it('frames the HUD cards draw (machines, workers, the desk, icons, parcels, fx) are in world', () => {
    const hud = names.filter(
      (n) =>
        n === 'desk' ||
        n.startsWith('worker_') ||
        n.startsWith('ic_') ||
        n.startsWith('parcel_') ||
        n.startsWith('fx_') ||
        /^(metal_detector|shaky_shaker|battery_checker|xray|sorter_arm)/.test(
          n,
        ),
    )
    expect(hud.length).toBeGreaterThan(50)
    for (const n of hud) expect(inAtlas(n, 'world'), n).toBe(true)
  })

  it('the room draws its art and the shared icons from interior, panels from world', () => {
    for (const n of names) {
      if (
        /^(floor_t|wall_t|wallface_t|shelf_t|sign_t\d|dock_tail_|dock_door_)/.test(
          n,
        )
      ) {
        expect(FRAME_ATLAS[n], n).toBe('interior')
        expect(roomAtlas(n), n).toBe('interior')
      }
    }
    for (const n of [
      'ic_alert',
      'ic_check',
      'parcel_s',
      'worker_e_idle_0',
      'desk',
    ]) {
      if (!(n in FRAMES)) continue
      expect(roomAtlas(n), n).toBe('interior')
      expect(atlasOf(n), n).toBe('world')
    }
    expect(roomAtlas('ui_banner')).toBe('world')
    expect(roomAtlas('no_such_frame')).toBe('world')
    expect(atlasOf('no_such_frame')).toBe('world')
  })
})
