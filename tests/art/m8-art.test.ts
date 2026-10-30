// Build-2 M8 art contracts (design-m8-m9 §6.1, §6.4, §8 "C ↔ F"; plan-build2
// §6 Airport / Park & civic, §8.5; B2 §4.1, §6.5, §6.6): the tier-3 room
// pieces (names, canvases, atlases, the 20x5 @11 shelf geometry, the dock
// pad's six spots), the overseas icons, the per-bay docked poses, and the
// L5 regions' unique sprites replacing the shared scenery.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FRAME_ATLAS,
  SPRITE_MAP,
  WH_ANCHORS,
  inAtlas,
} from '../../src/render/frames.generated.ts'
import { atlasesOf } from '../../tools/art/atlas.ts'
import { type Img, bbox, get, readImg } from '../../tools/art/iso.ts'
import {
  ROOT,
  buildingCoverage,
  dockPosesOf,
  finalPath,
  getEntry,
  loadBuildingIds,
  loadManifest,
  validateManifest,
  warehouseAnchorTable,
} from '../../tools/art/manifest.ts'
import { promptFor } from '../../tools/art/prompts.ts'

const m = loadManifest()

function final(id: string, suffix = ''): Img {
  return readImg(finalPath(getEntry(m, id), id + suffix)).img
}

const ROOM: [string, string, [number, number]][] = [
  ['floor_t3', 'interior-tile', [32, 32]],
  ['floor_t3_lane', 'interior-tile', [32, 32]],
  ['wall_t3', 'interior-tile', [32, 32]],
  ['wallface_t3', 'interior-tile', [32, 32]],
  ['sign_t3', 'sign', [200, 24]],
  ['shelf_t3', 'fixture-shelf', [224, 64]],
  ['props_t3', 'interior-prop', [48, 64]],
  ['wanted_poster_t3', 'interior-prop', [32, 32]],
  ['dock_pad', 'interior-prop', [24, 56]],
]

describe('tier-3 room pieces (design-m8-m9 §6.4): room back layers, interior atlas', () => {
  for (const [id, cls, canvas] of ROOM) {
    it(`${id}: ${cls} ${canvas.join('x')}, procedural, interior only`, () => {
      const e = getEntry(m, id)
      expect(e.class).toBe(cls)
      expect(e.source).toBe('procedural')
      expect(e.canvas).toEqual(canvas)
      expect(e.frames).toEqual([''])
      expect(atlasesOf(e)).toEqual(['interior'])
      expect(existsSync(finalPath(e, id)), id).toBe(true)
      expect(bbox(final(id)), id).not.toBeNull()
      expect((FRAME_ATLAS as Record<string, string>)[id]).toBe('interior')
    })
  }

  it('the floor and wall tiles are opaque 32x32 (they tile the room)', () => {
    for (const id of ['floor_t3', 'floor_t3_lane', 'wall_t3', 'wallface_t3']) {
      const img = final(id)
      expect(
        img.px.every((p) => p >= 0),
        id,
      ).toBe(true)
    }
  })

  it('floor_t3_lane = floor_t3 plus the 2-px yellow lane lines at x 0-1 / 30-31', () => {
    const lane = final('floor_t3_lane')
    for (const x of [0, 1, 30, 31]) {
      for (let y = 0; y < 32; y++) {
        expect(get(lane, x, y), `${x},${y}`).toMatch(/^yellow/)
      }
    }
    const plain = final('floor_t3')
    expect(get(plain, 16, 16)).toMatch(/^leaf/)
  })

  it('sign_t3: a light face in the text area (dark BitmapText, as t2)', () => {
    const img = final('sign_t3')
    let light = 0
    let n = 0
    for (let y = 4; y <= 19; y++) {
      for (let x = 8; x <= 191; x++) {
        n++
        if (get(img, x, y) === 'grey5') light++
      }
    }
    expect(light / n).toBeGreaterThan(0.9)
  })

  it('shelf_t3: five deck rows for the 20x5 @11 grid (minis at x 3 + 11c, y 4 + 11r)', () => {
    const img = final('shelf_t3')
    // opaque but for the bottom-left corner of the drop shadow (as t1 / t2)
    expect(img.px.slice(0, 224 * 63).every((p) => p >= 0)).toBe(true)
    for (let r = 0; r < 5; r++) {
      const y = 4 + 11 * r
      // the lit plank edge on top, the seam under the 10-px mini
      expect(get(img, 50, y), `row ${r} top`).toBe('grey5')
      expect(get(img, 50, y + 10), `row ${r} seam`).toBe('grey2')
    }
    // every mini cell lies inside the deck (x 3..221, y 4..57), above the beam
    for (let c = 0; c < 20; c++) {
      for (let r = 0; r < 5; r++) {
        const x = 3 + 11 * c
        const y = 4 + 11 * r
        expect(x + 9).toBeLessThanOrEqual(221)
        expect(y + 9).toBeLessThan(59)
      }
    }
    // the orange front beam under the last row, the outline at the bottom
    expect(get(img, 50, 60)).toMatch(/^orange/)
    expect(get(img, 50, 63)).toBe('outline')
  })

  it('dock_pad: a roller pad whose six mini spots (centred) fit inside it', () => {
    const img = final('dock_pad')
    expect(img.px.every((p) => p >= 0)).toBe(true)
    // rollers between the rails: alternating light / dark rows
    const col = new Set<string>()
    for (let y = 6; y <= 49; y++) col.add(get(img, 12, y) ?? '')
    expect(col.size).toBeGreaterThanOrEqual(3)
    for (const [cx, cy] of [
      [7, 11],
      [18, 11],
      [7, 27],
      [18, 27],
      [7, 43],
      [18, 43],
    ] as const) {
      // a 10x10 mini centred there stays on the pad
      expect(cx - 5).toBeGreaterThanOrEqual(1)
      expect(cx + 4).toBeLessThanOrEqual(22)
      expect(cy - 5).toBeGreaterThanOrEqual(5)
      expect(cy + 4).toBeLessThanOrEqual(50)
    }
  })
})

describe('dock-panel lock + overseas icons (design-m8-m9 §6.1-§6.3)', () => {
  it('lamp_lock: an 8x8 grey padlock, world (DockView front layer) like the lamps', () => {
    const e = getEntry(m, 'lamp')
    expect(e.frames).toContain('_lock')
    expect(atlasesOf(e)).toEqual(['world'])
    const img = final('lamp', '_lock')
    expect([img.w, img.h]).toEqual([8, 8])
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const id = get(img, x, y)
        if (id === null) continue
        expect(id === 'outline' || id.startsWith('grey'), `${x},${y}`).toBe(
          true,
        )
      }
    }
  })

  for (const id of ['ic_handoff', 'ic_cleared', 'ic_ship', 'ic_plane']) {
    it(`${id}: icon16, packed into both atlases (world home)`, () => {
      const e = getEntry(m, id)
      expect(e.class).toBe('icon16')
      expect(atlasesOf(e)).toEqual(['world', 'interior'])
      expect(inAtlas(id, 'world')).toBe(true)
      expect(bbox(final(id))).not.toBeNull()
    })
  }
})

describe('per-bay docked poses (design-m8-m9 §6.2 DOCK_POSES_CANVAS)', () => {
  it('every exterior frame carries one pose per bay light, the first = dockPose', () => {
    const table = warehouseAnchorTable(m)
    for (const [f, a] of Object.entries(table)) {
      expect(a.dockPoses, f).toHaveLength(a.bayLights.length)
      expect(a.dockPoses[0], f).toEqual(a.dockPose)
      // bay k keeps bay 1's offset from its own lamp
      const [l0x, l0y] = a.bayLights[0]!
      a.bayLights.forEach(([x, y], k) => {
        expect(a.dockPoses[k], `${f} bay ${k + 1}`).toEqual([
          a.dockPose[0] + x - l0x,
          a.dockPose[1] + y - l0y,
        ])
      })
    }
  })

  it('frames.generated WH_ANCHORS carries them (t3: 2 bays, t4 / t5: 3)', () => {
    const gen = WH_ANCHORS as Readonly<
      Record<string, { dockPoses?: readonly (readonly number[])[] } | undefined>
    >
    expect(gen.wh_ext_t1?.dockPoses).toHaveLength(3)
    expect(gen.wh_ext_t3?.dockPoses).toHaveLength(2)
    expect(gen.wh_ext_t4?.dockPoses).toHaveLength(3)
    expect(gen.wh_ext_t5?.dockPoses).toHaveLength(3)
  })

  it('an explicit manifest dockPoses wins; a bad one fails validation', () => {
    expect(
      dockPosesOf({
        bayLights: [
          [10, 10],
          [20, 15],
        ],
        dockPose: [1, 50],
        dockPoses: [
          [1, 50],
          [9, 60],
        ],
      }),
    ).toEqual([
      [1, 50],
      [9, 60],
    ])
    const bad = structuredClone(m)
    const t3 = bad.entries.find((e) => e.id === 'wh_ext_t3')!
    t3.dockPoses = [[0, 0]]
    expect(validateManifest(bad).join('\n')).toMatch(/dockPoses/)
  })
})

const AIRPORT = ['ap_terminal', 'ap_cargo_hangar']
const CIVIC = [
  'cv_town_hall',
  'cv_lint_school',
  'cv_museum',
  'cv_changelog_stadium',
  'cv_patch_hospital',
  'cv_police',
  'cv_fire',
  'cv_readme_library',
  'cv_courthouse',
  'cv_park_pavilion',
]
const RETIRED = [
  'ap_hangar',
  'cv_hall',
  'cv_stadium',
  'cv_civic_2x2',
  'cv_pavilion',
]

describe('L5 regions (plan-build2 §6, B2 §6.5): one unique sprite per building', () => {
  it('every Airport / Park & civic building maps to its own sprite', () => {
    const ids = loadBuildingIds() ?? []
    const { map, errors } = buildingCoverage(m, ids)
    expect(errors).toEqual([])
    for (const id of [...AIRPORT, ...CIVIC]) {
      expect(map.get(id), id).toBe(id)
      expect(SPRITE_MAP[id] ?? id, id).toBe(id)
    }
    const spriteMap = JSON.parse(
      readFileSync(`${ROOT}src/render/spriteMap.generated.json`, 'utf8'),
    ) as Record<string, string>
    for (const id of [...AIRPORT, ...CIVIC]) {
      expect(spriteMap[id] ?? id, id).toBe(id)
    }
  })

  for (const id of [...AIRPORT, ...CIVIC, 'ap_tower', 'ap_plane', 'fountain']) {
    it(`${id}: a PixelLab pick (agent), shipped with its _locked twin`, () => {
      const e = getEntry(m, id)
      expect(e.source).toBe('pixellab')
      expect(e.placeholder).toBe(false)
      expect(e.chosenCandidate).toBeTypeOf('number')
      expect(e.approved).toBe(false)
      expect(e.variants).toEqual(['locked'])
      expect(existsSync(finalPath(e, id)), id).toBe(true)
      expect(existsSync(finalPath(e, `${id}_locked`)), id).toBe(true)
      expect(inAtlas(id, 'world')).toBe(true)
      expect(inAtlas(`${id}_locked`, 'world')).toBe(true)
    })
  }

  it('the shared scenery rows are retired (provenance kept, finals deleted)', () => {
    for (const id of RETIRED) {
      expect(
        m.entries.some((e) => e.id === id),
        id,
      ).toBe(false)
      const r = m.retired?.find((x) => x.id === id)
      expect(r, id).toBeDefined()
      expect(r!.gen.length, id).toBeGreaterThan(0)
      expect(inAtlas(id, 'world'), id).toBe(false)
    }
  })

  it('prompts: the plane taxis east (nose lower right), cv_fire / ap_plane may show vehicles', () => {
    const plane = promptFor(getEntry(m, 'ap_plane')).text
    expect(plane).toMatch(/nose pointing to the lower right/)
    expect(plane).not.toMatch(/no vehicles/)
    expect(promptFor(getEntry(m, 'cv_fire')).text).not.toMatch(/no vehicles/)
    // M9 re-roll: the ship sails west along -x, bow first (m9-art.test.ts)
    expect(promptFor(getEntry(m, 'dk_ship')).text).toMatch(
      /bow pointing to the upper left/,
    )
    // the re-rolled stadium asks for nothing around the pitch (report §6.25)
    expect(promptFor(getEntry(m, 'cv_changelog_stadium')).text).toMatch(
      /no townhouses/,
    )
  })
})

describe('contact sheets (M8 G5 / G6)', () => {
  it('docks, airport, civic and warehouse-tier3 sheets exist', () => {
    for (const f of [
      'docks@4x.png',
      'airport@4x.png',
      'civic@4x.png',
      'warehouse-tier3@4x.png',
    ]) {
      expect(existsSync(`${ROOT}art/contact/${f}`), f).toBe(true)
    }
  })
})
