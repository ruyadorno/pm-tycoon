// Build-2 M5 art contracts (plan-build2 §8.2 tasks 4, 5, 7, 10; B2 §6.1-§6.4):
// lint A04 strict for the warehouse exterior, the exterior candidate fit,
// the scripted worker scan pose, the manifest rows (bike foot, logo, port
// coverage, retired rows) and the one-cloud fx_dust frames.
import { describe, expect, it } from 'vitest'
import {
  clearKeyPockets,
  isRequestedKey,
  processExterior,
  scanPose,
} from '../../tools/art/candidates.ts'
import { diamondSpans } from '../../tools/art/draw-api.ts'
import {
  type Img,
  bbox,
  exteriorBaseOk,
  get,
  newImg,
  opaque,
  put,
  readImg,
} from '../../tools/art/iso.ts'
import { WH_ANCHORS } from '../../src/render/frames.generated.ts'
import {
  ROOT,
  buildingCoverage,
  frameNames,
  getEntry,
  isAtlasPacked,
  loadBuildingIds,
  loadManifest,
  validateManifest,
  vehicleFoot,
  warehouseAnchors,
} from '../../tools/art/manifest.ts'

const W = 256

/** a 4x4 box: the footprint diamond's lower half + `h` rows of wall */
function box(h: number, inset = 0): Img {
  const img = newImg(W, W)
  const spans = diamondSpans(W - 4 * inset)
  const row0 = W - spans.length - inset
  const left = 2 * inset
  spans.forEach(([s0, s1], r) => {
    for (let x = left + s0; x <= left + s1; x++) {
      for (
        let y = row0 + r - (r < spans.length / 2 ? 0 : h);
        y <= row0 + r;
        y++
      ) {
        put(img, x, y, 'grey3')
      }
    }
  })
  return img
}

describe('lint A04 strict (warehouse-ext, B2 §6.1)', () => {
  it('passes walls standing on the 256x128 diamond', () => {
    expect(exteriorBaseOk(box(80), W)).toEqual([])
  })

  it('passes a base inset within the rim allowance', () => {
    expect(exteriorBaseOk(box(80, 3), W)).toEqual([])
  })

  it('flags an apron pixel below the diamond edge', () => {
    const img = box(80)
    put(img, 10, W - 2, 'grey3')
    expect(exteriorBaseOk(img, W)[0]).toMatch(/below the diamond edge/)
  })

  it('flags a building floating above the anchor', () => {
    const img = box(80, 10)
    expect(exteriorBaseOk(img, W).join(' ')).toMatch(/wall base/)
  })
})

describe('processExterior (no apron, B2 §6.1)', () => {
  it('puts the base on the anchor and clips everything below the edges', () => {
    // a 240-px box with a stray ground strip under it, off-centre
    const src = newImg(W, W)
    const b = box(60, 4)
    for (let k = 0; k < b.px.length; k++) src.px[k] = b.px[k] as number
    for (let x = 0; x < W; x++) put(src, x, W - 1, 'grey2')
    const pr = processExterior(
      {
        ...getEntry(loadManifest(), 'wh_ext'),
        placeholder: false,
      },
      src,
      '_t1',
    )
    const img = pr.frames.get('_t1') as Img
    expect(img).toBeDefined()
    expect(exteriorBaseOk(img, W)).toEqual([])
  })
})

describe('worker scan frames scripted from idle (report §6.24)', () => {
  const idle = (d: string, k: number) =>
    readImg(`${ROOT}art/final/worker/worker_${d}_idle_${k}.png`).img
  for (const d of ['s', 'e', 'w']) {
    it(`${d}: same height as idle (never below the desk), the scanner drawn`, () => {
      for (const k of [0, 1]) {
        const base = idle(d, k)
        const scan = scanPose(base, d, k)
        const bi = bbox(base)
        const bs = bbox(scan)
        expect(bs?.y1).toBe(bi?.y1)
        expect((bs?.y0 ?? 0) >= (bi?.y0 ?? 0) - 1).toBe(true)
        expect(scan.w).toBe(24)
        expect(scan.h).toBe(32)
        let changed = 0
        for (let i = 0; i < scan.px.length; i++) {
          if (scan.px[i] !== base.px[i]) changed++
        }
        expect(changed).toBeGreaterThan(8)
      }
    })
  }
  it('n: the back view stays the idle frame', () => {
    const base = idle('n', 0)
    expect(Array.from(scanPose(base, 'n', 0).px)).toEqual(Array.from(base.px))
  })
})

describe('warehouse exterior anchors on the art (M5 review)', () => {
  // The bay lamps are yellow1 / orange2 pixels on the SW face; every frame's
  // bayLights (frames.generated WH_ANCHORS, from the manifest) sits on one,
  // as tier 1's do (the first _t2 set put bays 2-3 on the blue wall).
  const LAMP = new Set(['yellow1', 'orange2'])
  const frames = Object.entries(WH_ANCHORS)
  it('lists tier 1 and tier 2', () => {
    expect(frames.map(([f]) => f)).toEqual(
      expect.arrayContaining(['wh_ext_t1', 'wh_ext_t2']),
    )
  })
  for (const [frame, set] of frames) {
    it(`${frame}: every bay light is within 2 px of an amber lamp pixel`, () => {
      const img = readImg(`${ROOT}art/final/warehouse-ext/${frame}.png`).img
      for (const [ax, ay] of set!.bayLights) {
        let best = Infinity
        for (let y = ay - 3; y <= ay + 3; y++)
          for (let x = ax - 3; x <= ax + 3; x++)
            if (LAMP.has(get(img, x, y) ?? ''))
              best = Math.min(best, Math.hypot(x - ax, y - ay))
        expect(best, `${frame} light (${ax}, ${ay})`).toBeLessThanOrEqual(2)
      }
    })
  }
})

/** One opaque RGBA pixel. */
const px = (rgb: number): Buffer =>
  Buffer.from([rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255])

describe('key pockets only for a requested key colour (M5 review)', () => {
  it('magenta to dusty pink and cyan are the requested keys; a grey or green ground is not', () => {
    for (const k of [0xff00ff, 0xcd3e7b, 0xdf23b3, 0xef06f2, 0x00ffff])
      expect(isRequestedKey(k), k.toString(16)).toBe(true)
    for (const k of [0x808080, 0xfcf9f1, 0x4c7bd0, 0x6ab04c, 0x241e32])
      expect(isRequestedKey(k), k.toString(16)).toBe(false)
  })
  it('clears enclosed key pixels for magenta, keeps a grey key colour inside the sprite', () => {
    const magenta = Buffer.concat([px(0xff00ff), px(0x241e32), px(0xf010f0)])
    expect(clearKeyPockets(magenta, 0xff00ff, 40)).toBe(2)
    expect([magenta[3], magenta[7], magenta[11]]).toEqual([0, 255, 0])
    const grey = Buffer.concat([px(0x808080), px(0x241e32)])
    expect(clearKeyPockets(grey, 0x808080, 40)).toBe(0)
    expect(grey[3]).toBe(255)
  })
})

describe('manifest rows (plan-build2 §8.2)', () => {
  const m = loadManifest()

  it('is valid, every building covered once', () => {
    expect(validateManifest(m)).toEqual([])
  })

  it('bike: 32x32 with its foot point in the manifest (Q-B2-14)', () => {
    const bike = getEntry(m, 'bike')
    expect(bike.canvas).toEqual([32, 32])
    expect(vehicleFoot(bike)).toEqual([16, 26])
    expect(vehicleFoot(getEntry(m, 'van'))).toEqual([16, 23])
    expect(vehicleFoot(getEntry(m, 'truck'))).toEqual([24, 22])
  })

  it('the modern port covers the piers and the customs house (F5)', () => {
    const ids = loadBuildingIds() ?? []
    const { map } = buildingCoverage(m, ids)
    expect(map.get('dk_pier_1')).toBe('dk_terminal_a')
    expect(map.get('dk_pier_2')).toBe('dk_terminal_b')
    expect(map.get('dk_customs')).toBe('dk_port_office')
    for (const id of ['dk_terminal_a', 'dk_terminal_b', 'dk_port_office']) {
      expect(frameNames(getEntry(m, id))).toContain(`${id}_locked`)
    }
    const retired = (m.retired ?? []).map((r) => r.id)
    expect(retired).toEqual(expect.arrayContaining(['dk_pier', 'dk_customs']))
    expect(m.entries.some((e) => retired.includes(e.id))).toBe(false)
  })

  it('contract 2 frame names exist', () => {
    const names = new Set(m.entries.flatMap((e) => frameNames(e)))
    for (const n of [
      'lot_slab_a',
      'lot_slab_b',
      'lot_slab_c',
      'lot_ramp',
      'bollard_a',
      'bollard_b',
      'wh_ext_t1',
      'wh_ext_t2',
      'bike_ne_0',
      'bike_sw_1',
    ]) {
      expect(names.has(n), n).toBe(true)
    }
  })

  it('the logo is author art, never packed (B2 §5)', () => {
    const logo = getEntry(m, 'logo')
    expect(logo.source).toBe('author')
    expect(logo.canvas).toEqual([352, 176])
    expect(isAtlasPacked(logo)).toBe(false)
  })

  it('the exterior anchors the city reads are in the manifest', () => {
    const a = warehouseAnchors(m)
    expect(a?.bayLights).toHaveLength(3)
    expect(a?.dockPose).toHaveLength(2)
  })
})

describe('fx_dust: one cloud per frame (report §6.23)', () => {
  /** 4-connected components of opaque pixels */
  function components(img: Img): number {
    const seen = new Uint8Array(img.w * img.h)
    let n = 0
    for (let i = 0; i < seen.length; i++) {
      if (seen[i] || (img.px[i] as number) < 0) continue
      n++
      const stack = [i]
      seen[i] = 1
      while (stack.length) {
        const k = stack.pop() as number
        const x = k % img.w
        const y = (k - x) / img.w
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ] as const) {
          if (!opaque(img, nx, ny)) continue
          const nk = ny * img.w + nx
          if (seen[nk]) continue
          seen[nk] = 1
          stack.push(nk)
        }
      }
    }
    return n
  }

  it('the dust frames are single masses on the exterior-sized canvas', () => {
    const e = getEntry(loadManifest(), 'fx_dust')
    expect(e.canvas).toEqual([256, 224])
    for (const f of ['_f1', '_f2']) {
      const { img } = readImg(`${ROOT}art/final/fx/fx_dust${f}.png`)
      expect(components(img), f).toBe(1)
    }
  })
})
