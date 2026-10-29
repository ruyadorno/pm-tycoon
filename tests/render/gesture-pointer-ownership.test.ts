// city-view.md §10 gestures, M4 bug hunt: only pointers whose pointerdown the
// city received take part in its gestures. A finger tapping a HUD button
// (the HUD scene captures that down) while another finger pans the city must
// neither turn the pan into a pinch (a spurious zoom, then a frozen pan) nor,
// through its stray pointerup, fling the camera or make the next move
// re-apply the whole drag. Real two-finger pinches, taps, double-taps and
// long-presses classify as before.
import { describe, expect, it } from 'vitest'
import {
  GestureClassifier,
  HOLD_MS,
  type GestureHost,
  type GesturePointer,
} from '../../src/input/GestureClassifier.ts'

type Fn = (...args: unknown[]) => void

class FakeInput {
  private map = new Map<string, { fn: Fn; ctx: unknown }[]>()
  on(ev: string, fn: Fn, ctx?: unknown): this {
    const l = this.map.get(ev) ?? []
    l.push({ fn, ctx })
    this.map.set(ev, l)
    return this
  }
  off(ev: string, fn: Fn, ctx?: unknown): this {
    const l = this.map.get(ev) ?? []
    this.map.set(
      ev,
      l.filter((e) => e.fn !== fn || e.ctx !== ctx),
    )
    return this
  }
  emit(ev: string, ...args: unknown[]): void {
    for (const e of (this.map.get(ev) ?? []).slice()) e.fn.apply(e.ctx, args)
  }
  count(): number {
    let n = 0
    for (const l of this.map.values()) n += l.length
    return n
  }
}

interface Rig {
  input: FakeInput
  host: GestureHost & { time: { now: number } }
  log: string[]
  pans: [number, number][]
  g: GestureClassifier
}

function rig(): Rig {
  const input = new FakeInput()
  const host = {
    input,
    time: { now: 0 },
    events: { once: () => host, off: () => host },
  } as unknown as Rig['host']
  const log: string[] = []
  const pans: [number, number][] = []
  const g = new GestureClassifier(host, {
    tap: (x, y) => log.push(`tap ${x},${y}`),
    doubleTap: (x, y) => log.push(`double ${x},${y}`),
    longPress: (x, y) => log.push(`long ${x},${y}`),
    panBy: (dx, dy) => pans.push([dx, dy]),
    panEnd: (vx, vy) => log.push(`panEnd ${vx},${vy}`),
    pinch: (dir) => log.push(`pinch ${dir}`),
  })
  return { input, host, log, pans, g }
}

function pointer(id: number): GesturePointer {
  return {
    id,
    x: 0,
    y: 0,
    isDown: false,
    prevPosition: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    rightButtonDown: () => false,
  }
}

/** Put the finger down; `deliver: false` = a scene above captured the event. */
function down(r: Rig, p: GesturePointer, x: number, y: number, deliver = true) {
  p.isDown = true
  p.x = x
  p.y = y
  p.prevPosition = { x, y }
  if (deliver) r.input.emit('pointerdown', p)
}
function move(r: Rig, p: GesturePointer, x: number, y: number) {
  p.prevPosition = { x: p.x, y: p.y }
  p.velocity = { x: x - p.x, y: y - p.y }
  p.x = x
  p.y = y
  r.input.emit('pointermove', p)
}
function up(r: Rig, p: GesturePointer, deliver = true) {
  p.isDown = false
  if (deliver) r.input.emit('pointerup', p)
}
const total = (pans: [number, number][]): [number, number] =>
  pans.reduce<[number, number]>((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0])

describe('GestureClassifier: a HUD tap during a city pan', () => {
  it('neither pinches nor freezes the pan while the HUD finger is down', () => {
    const r = rig()
    const city = pointer(1)
    const hud = pointer(2)
    down(r, city, 100, 300)
    move(r, city, 120, 300) // pan starts (+20)
    down(r, hud, 300, 620, false) // the HUD button captured this down
    move(r, city, 140, 300)
    move(r, city, 160, 340)
    move(r, hud, 302, 621) // a HUD finger wobble reaches the city scene
    expect(r.log.filter((l) => l.startsWith('pinch'))).toEqual([])
    expect(r.g.gesture).toBe('pan')
    expect(total(r.pans)).toEqual([60, 40])
  })

  it('ignores the HUD finger’s stray pointerup: no fling, no jump', () => {
    const r = rig()
    const city = pointer(1)
    const hud = pointer(2)
    down(r, city, 100, 300)
    move(r, city, 150, 300)
    down(r, hud, 300, 620, false)
    hud.velocity = { x: 99, y: 99 }
    up(r, hud) // delivered: the finger slid off the button before lifting
    expect(r.log).toEqual([])
    const before = total(r.pans)
    move(r, city, 155, 300)
    // One 5-px step, not the 55 px since the original down again.
    expect(total(r.pans)).toEqual([before[0] + 5, before[1]])
    expect(r.g.gesture).toBe('pan')
    up(r, city)
    expect(r.log).toEqual([`panEnd 5,0`])
  })

  it('still taps after a HUD finger’s up was lost (captured elsewhere)', () => {
    const r = rig()
    const city = pointer(1)
    down(r, city, 100, 300)
    up(r, city, false) // the HUD scene got this up
    down(r, city, 50, 200)
    up(r, city)
    expect(r.log).toEqual(['tap 50,200'])
    expect(r.g.pointers).toBe(0)
  })
})

describe('GestureClassifier: two city fingers still pinch', () => {
  it('pinches out (zoom in) when both downs reached the city', () => {
    const r = rig()
    const a = pointer(1)
    const b = pointer(2)
    down(r, a, 100, 300)
    down(r, b, 200, 300)
    move(r, b, 240, 300) // 140 / 100 = 1.4 ≥ 1.25
    expect(r.log).toEqual(['pinch in'])
    expect(r.g.gesture).toBe('pinch')
  })

  it('turns a pan into a pinch when a second city finger lands', () => {
    const r = rig()
    const a = pointer(1)
    const b = pointer(2)
    down(r, a, 100, 300)
    move(r, a, 130, 300)
    const pans = r.pans.length
    down(r, b, 230, 300)
    move(r, a, 110, 300) // 120 / 100 = 1.2: no step yet, no pan either
    move(r, a, 150, 300) // 80 / 100 = 0.8 → pinch out
    expect(r.pans.length).toBe(pans)
    expect(r.log).toEqual(['pinch out'])
  })

  it('a finger left after a pinch does not jump the camera', () => {
    const r = rig()
    const a = pointer(1)
    const b = pointer(2)
    down(r, a, 100, 300)
    down(r, b, 200, 300)
    up(r, a)
    move(r, b, 260, 300)
    expect(r.pans).toEqual([]) // pans stay off until every finger lifts
    up(r, b)
    expect(r.g.gesture).toBe('none')
    expect(r.g.pointers).toBe(0)
  })
})

describe('GestureClassifier: single-finger gestures unchanged', () => {
  it('tap, then double-tap within 300 ms / 16 px', () => {
    const r = rig()
    const p = pointer(1)
    down(r, p, 100, 100)
    r.host.time.now = 100
    up(r, p)
    r.host.time.now = 250
    down(r, p, 104, 102)
    r.host.time.now = 300
    up(r, p)
    expect(r.log).toEqual(['tap 100,100', 'double 104,102'])
  })

  it('long-press after HOLD_MS, then a drag does not pan', () => {
    const r = rig()
    const p = pointer(1)
    down(r, p, 80, 90)
    r.host.time.now = HOLD_MS + 1
    r.g.update()
    move(r, p, 140, 90)
    up(r, p)
    expect(r.log).toEqual(['long 80,90'])
    expect(r.pans).toEqual([])
  })

  it('removes every listener on destroy', () => {
    const r = rig()
    expect(r.input.count()).toBe(6)
    r.g.destroy()
    expect(r.input.count()).toBe(0)
  })
})
