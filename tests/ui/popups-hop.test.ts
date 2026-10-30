// spec-build2.md §6.3 (the author's city #3, plan-build2 §8.2 task 6): trucks
// and vans never show parcels on their roof. The pickup hop (building door →
// vehicle) ends on the vehicle's body centre (foot point − 4 px) and its icon
// shrinks to nothing over the last 40 % of the flight; the delivery hop
// starts on the body centre at full size. The shrink is a centred crop
// window on whole pixels (no setScale on world art, style-guide.md §7).
// A chainable fake scene stands in for Phaser; Phaser itself is stubbed
// (Popups only needs Math.Easing.Sine.Out at runtime).
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => {
  class Stub {
    readonly stub = true
  }
  return {
    default: {
      Scene: Stub,
      GameObjects: { Container: Stub, NineSlice: Stub, Image: Stub },
      Geom: { Rectangle: Stub },
      Math: {
        Easing: { Sine: { Out: (k: number) => Math.sin((k * Math.PI) / 2) } },
      },
    },
  }
})

const { Popups, HOP_MS, HOP_SINK_FROM, hopIconSide, hopScale } =
  await import('../../src/ui/Popups.ts')
const { BODY_LIFT, bodyCentreAt } =
  await import('../../src/render/VehicleView.ts')

interface Crop {
  x: number
  y: number
  w: number
  h: number
}

/** The state of one fake game object (positions, visibility, the icon's crop). */
interface FakeState {
  kind: string
  x: number
  y: number
  alpha: number
  visible: boolean
  width: number
  frame: string
  crop: Crop | null
}

type Fake = FakeState & Record<string, unknown>

function fakeObj(kind: string, width = 16): Fake {
  const o: FakeState = {
    kind,
    x: 0,
    y: 0,
    alpha: 1,
    visible: true,
    width,
    frame: '',
    crop: null,
  }
  const proxy: Fake = new Proxy(o as Fake, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'setPosition')
        return (x: number, y?: number) => ((t.x = x), (t.y = y ?? x), proxy)
      if (k === 'setAlpha') return (v: number) => ((t.alpha = v), proxy)
      if (k === 'setVisible') return (v: boolean) => ((t.visible = v), proxy)
      if (k === 'setFrame') return (f: string) => ((t.frame = f), proxy)
      if (k === 'setCrop')
        return (x?: number, y?: number, w?: number, h?: number) => {
          t.crop =
            x === undefined ? null : { x, y: y ?? 0, w: w ?? 0, h: h ?? 0 }
          return proxy
        }
      return () => proxy
    },
  })
  return proxy
}

function fakeScene() {
  const icons: Fake[] = []
  const containers: Fake[] = []
  const scene = {
    cache: { bitmapFont: { has: () => false } },
    add: {
      image: () => {
        const i = fakeObj('image', 16)
        icons.push(i)
        return i
      },
      bitmapText: () => fakeObj('text', 40),
      nineslice: () => fakeObj('nineslice', 16),
      container: () => {
        const c = fakeObj('container')
        containers.push(c)
        return c
      },
    },
  }
  const layer = { add: () => layer }
  return { scene, layer, icons, containers }
}

const ALL = { contains: () => true }

/** Visible icon side as the fake records it: 16 uncropped, 0 hidden. */
function side(icon: Fake): number {
  if (!icon.visible) return 0
  return icon.crop ? icon.crop.w : icon.width
}

interface Frame {
  age: number
  x: number
  y: number
  side: number
  crop: Crop | null
  alive: boolean
}

/** Run one hop at 60 fps until it lands; the frames as drawn. */
function fly(sink: boolean) {
  const { scene, layer, icons, containers } = fakeScene()
  const p = new Popups(scene as never, layer as never)
  const start = { x: 100, y: 200 }
  const end = bodyCentreAt(260, 120)
  p.hop(ALL, start.x, start.y, end.x, end.y, 'ic_parcel_m', { sink })
  const icon = icons[0] as Fake
  const box = containers[0] as Fake
  const frames: Frame[] = [
    {
      age: 0,
      x: box.x,
      y: box.y,
      side: side(icon),
      crop: icon.crop,
      alive: p.alive > 0,
    },
  ]
  let age = 0
  while (p.alive > 0 && age < 2 * HOP_MS) {
    p.update(16)
    age += 16
    frames.push({
      age,
      x: box.x,
      y: box.y,
      side: side(icon),
      crop: icon.crop ? { ...icon.crop } : null,
      alive: p.alive > 0,
    })
  }
  return { p, icon, box, frames, start, end, scene, layer, icons }
}

describe('B2 §6.3 hop timing: scale → 0 over the last 40 % with sink', () => {
  it('without sink the icon stays full size the whole flight', () => {
    for (let k = 0; k <= 1; k += 0.05) expect(hopScale(k, false)).toBe(1)
  })

  it('with sink it is full size to 60 %, then falls linearly to 0 at 100 %', () => {
    expect(HOP_SINK_FROM).toBe(0.6)
    expect(hopScale(0, true)).toBe(1)
    expect(hopScale(0.6, true)).toBe(1)
    expect(hopScale(0.8, true)).toBeCloseTo(0.5)
    expect(hopScale(1, true)).toBe(0)
    let prev = 1
    for (let k = 0.6; k <= 1.0001; k += 0.01) {
      const s = hopScale(Math.min(1, k), true)
      expect(s).toBeLessThanOrEqual(prev)
      prev = s
    }
  })

  it('the crop window is an even number of whole pixels, 16 → 0', () => {
    expect(hopIconSide(1)).toBe(16)
    expect(hopIconSide(0.5)).toBe(8)
    expect(hopIconSide(0.1)).toBe(0)
    expect(hopIconSide(0)).toBe(0)
    for (let s = 0; s <= 1; s += 0.01) expect(hopIconSide(s) % 2).toBe(0)
  })

  it('the body centre is the foot point lifted 4 px', () => {
    expect(BODY_LIFT).toBe(4)
    expect(bodyCentreAt(260, 120)).toEqual({ x: 260, y: 116 })
  })
})

describe('B2 §6.3 pickup hop (sink): no icon ever rests on a vehicle', () => {
  it('the final frame lands on the body centre at size 0, then the slot frees', () => {
    const { frames, end, box, p } = fly(true)
    const last = frames[frames.length - 1] as Frame
    expect(last.alive).toBe(false)
    expect(last.side).toBe(0)
    expect(last.crop).toEqual({ x: 8, y: 8, w: 0, h: 0 })
    expect({ x: last.x, y: last.y }).toEqual(end)
    expect(box.visible).toBe(false)
    expect(p.alive).toBe(0)
  })

  it('full size for the first 60 % of the flight, then shrinking, centred', () => {
    const { frames } = fly(true)
    let prev = 16
    for (const f of frames) {
      const k = Math.min(1, f.age / HOP_MS)
      if (k <= HOP_SINK_FROM) {
        expect(f.side, `age ${f.age}`).toBe(16)
        expect(f.crop).toBeNull()
        continue
      }
      expect(f.side, `age ${f.age}`).toBeLessThanOrEqual(prev)
      expect(f.side).toBe(hopIconSide(hopScale(k, true)))
      if (f.crop) {
        // Centred on the icon's middle, on whole pixels.
        expect(f.crop.x).toBe((16 - f.crop.w) / 2)
        expect(f.crop.y).toBe((16 - f.crop.h) / 2)
        expect(Number.isInteger(f.crop.x)).toBe(true)
      }
      prev = f.side
    }
    // It really shrinks before it lands (not a pop at the end).
    const mid = frames.filter((f) => f.alive && f.side > 0 && f.side < 16)
    expect(mid.length).toBeGreaterThanOrEqual(3)
  })

  it('the icon is never drawn full size near the vehicle: shrinking from 60 %', () => {
    const { frames, end } = fly(true)
    const near = frames.filter(
      (f) => f.alive && Math.hypot(f.x - end.x, f.y - end.y) <= 12,
    )
    expect(near.length).toBeGreaterThan(0)
    for (const f of near) expect(f.side).toBeLessThan(16)
  })
})

describe('B2 §6.3 delivery hop (no sink): starts on the body at full size', () => {
  it('the first frame sits on the body centre with the whole icon', () => {
    const { scene, layer, icons, containers } = fakeScene()
    const p = new Popups(scene as never, layer as never)
    const body = bodyCentreAt(140, 90)
    p.hop(ALL, body.x, body.y, 300, 220, 'ic_parcel_s')
    const icon = icons[0] as Fake
    const box = containers[0] as Fake
    expect({ x: box.x, y: box.y }).toEqual(body)
    expect(icon.visible).toBe(true)
    expect(icon.crop).toBeNull()
    expect(side(icon)).toBe(16)
  })

  it('stays full size for the whole flight and frees the slot at 300 ms', () => {
    const { frames, p } = fly(false)
    for (const f of frames.filter((x) => x.alive)) {
      expect(f.side).toBe(16)
      expect(f.crop).toBeNull()
    }
    expect(frames[frames.length - 1]?.age).toBeGreaterThanOrEqual(HOP_MS)
    expect(p.alive).toBe(0)
  })
})

describe('the pool reuses a sunk slot with the whole icon', () => {
  it('a hop after a sinking hop starts uncropped and visible', () => {
    const { p, icon } = fly(true)
    expect(icon.crop).not.toBeNull()
    p.hop(ALL, 0, 0, 50, 50, 'ic_parcel_l')
    expect(icon.crop).toBeNull()
    expect(icon.visible).toBe(true)
    expect(icon.frame).toBe('ic_parcel_l')
  })

  it('a pickup popup recycling a mid-sink slot shows the whole icon', () => {
    const { scene, layer, icons } = fakeScene()
    const p = new Popups(scene as never, layer as never)
    p.setCapacity(1)
    p.hop(ALL, 0, 0, 80, 40, 'ic_parcel_m', { sink: true })
    p.update(HOP_MS * 0.85)
    const icon = icons[0] as Fake
    expect(icon.crop).not.toBeNull()
    // The pool is full: the pickup recycles the hop's slot.
    p.pickup(ALL, 'b1', 20, 20, 'ic_parcel_s')
    expect(icon.crop).toBeNull()
    expect(icon.visible).toBe(true)
    expect(icon.frame).toBe('ic_parcel_s')
  })
})
