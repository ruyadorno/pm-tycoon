// city-view.md §7.5 / plan.md §6.7: a confirm dialog never outlives its
// scene's sleep. The HUD sleeps the Garage under a lost-life, game-over or
// Paused card (a modal card never renders under the sheet); the Garage's
// `Sell vehicle` dialog stayed on the modal stack while its scene slept, so
// every HUD shortcut (Space, 1, 2, W, G) and every onboarding card waited on
// a dialog nobody could see, and the stale question came back when the
// Garage reopened. A sleeping scene now cancels its dialog, as it closes the
// ZonePicker. Phaser is stubbed with chainable no-op game objects (Dialog
// builds real Buttons, which extend Container).
import { describe, expect, it, vi } from 'vitest'

type Bag = Record<string | symbol, unknown>

/** A game object whose unknown methods are chainable no-ops. */
function chain<T extends object>(target: T): T {
  const base = target as Bag
  for (const [k, v] of Object.entries({
    x: 0,
    y: 0,
    width: 40,
    height: 14,
    visible: true,
    alpha: 1,
  }))
    if (!(k in base)) base[k] = v
  const proxy: T = new Proxy(target, {
    get(t, k, receiver) {
      if (k in t) return Reflect.get(t, k, receiver)
      if (k === 'getTextBounds') return () => ({ lines: { lengths: [1] } })
      if (typeof k === 'symbol') return undefined
      return () => proxy
    },
  })
  return proxy
}

vi.mock('phaser', () => {
  class GameObject {
    readonly stub = true
    constructor() {
      return chain(this)
    }
  }
  class Rectangle {
    readonly stub = true
  }
  return {
    default: {
      GameObjects: {
        Container: GameObject,
        NineSlice: GameObject,
        Image: GameObject,
      },
      Geom: { Rectangle },
    },
  }
})

const { Dialog } = await import('../../src/ui/Dialog.ts')
const { modalCount, topModal } = await import('../../src/ui/Sheet.ts')

function emitter() {
  const ls = new Map<
    string,
    { fn: () => void; ctx: unknown; once: boolean }[]
  >()
  const add = (n: string, fn: () => void, ctx: unknown, once: boolean) => {
    ls.set(n, [...(ls.get(n) ?? []), { fn, ctx, once }])
  }
  return {
    on: (n: string, fn: () => void, ctx?: unknown) => add(n, fn, ctx, false),
    once: (n: string, fn: () => void, ctx?: unknown) => add(n, fn, ctx, true),
    off: (n: string, fn: () => void, ctx?: unknown) => {
      ls.set(
        n,
        (ls.get(n) ?? []).filter((l) => !(l.fn === fn && l.ctx === ctx)),
      )
    },
    emit: (n: string) => {
      const list = ls.get(n) ?? []
      ls.set(
        n,
        list.filter((l) => !l.once),
      )
      for (const l of list) l.fn.call(l.ctx)
    },
    count: (n: string) => (ls.get(n) ?? []).length,
  }
}

const obj = (): object => chain({})

function fakeScene() {
  const removed: unknown[] = []
  const scene = {
    scale: { width: 360, height: 604, zoom: 1 },
    add: {
      rectangle: obj,
      nineslice: obj,
      bitmapText: obj,
      image: obj,
      container: obj,
      existing: (o: unknown) => o,
    },
    cameras: {
      cameras: [] as unknown[],
      add: () => chain({}),
      remove: (c: unknown) => removed.push(c),
    },
    children: { list: [] as unknown[] },
    input: { keyboard: emitter() },
    events: emitter(),
    game: { events: emitter() },
    time: { addEvent: () => ({ remove() {} }) },
  }
  return { scene, removed }
}

function open(
  scene: ReturnType<typeof fakeScene>['scene'],
  onCancel = vi.fn(),
  onConfirm = vi.fn(),
) {
  const d = new Dialog(scene as never, {
    title: 'Sell vehicle',
    text: 'Sell Bike 1 for $100? Its parcels go back to the warehouse.',
    action: 'Sell',
    destructive: true,
    onConfirm,
    onCancel,
  })
  return { d, onCancel, onConfirm }
}

describe('a Dialog cancels when its scene sleeps', () => {
  it('leaves the modal stack and runs onCancel once', () => {
    const { scene, removed } = fakeScene()
    const before = modalCount()
    const { d, onCancel, onConfirm } = open(scene)
    expect(modalCount()).toBe(before + 1)
    expect(topModal()).toBe(d)

    scene.events.emit('sleep')
    expect(d.isOpen()).toBe(false)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(modalCount()).toBe(before)
    expect(removed).toContain(d.cam)

    // A later sleep / wake cycle does nothing more.
    scene.events.emit('wake')
    scene.events.emit('sleep')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(modalCount()).toBe(before)
  })

  it('drops its sleep listener when it closes first', () => {
    const { scene } = fakeScene()
    const { d, onCancel, onConfirm } = open(scene)
    expect(scene.events.count('sleep')).toBe(1)
    d.confirm()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(scene.events.count('sleep')).toBe(0)
    scene.events.emit('sleep')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('still closes silently on shutdown', () => {
    const { scene } = fakeScene()
    const before = modalCount()
    const { d, onCancel } = open(scene)
    scene.events.emit('shutdown')
    expect(d.isOpen()).toBe(false)
    expect(onCancel).not.toHaveBeenCalled()
    expect(modalCount()).toBe(before)
    expect(scene.events.count('sleep')).toBe(0)
  })
})
