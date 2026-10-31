// report-playtest1 §6.5 / plan-build2 §8.2 task 10: the Paused card (the
// pause menu and the auto-pause card) is on the shared modal stack while it
// shows. Under it the keys that only act with no modal open — the HUD's W
// (view switch) and G (Garage) and the Warehouse's Esc-to-City, which all
// call claimKey(ev, null) — do nothing; Esc resumes like a tap; a modal
// opened above it owns the keys; sleep/shutdown never leak a stack entry.
// Phaser is stubbed with chainable no-op game objects (the card builds a
// real Button, which extends Container).
// Build 3 M12 (B3 §3.4): with onEffects the card carries a second entry,
// `Effects · N` (hidden at 0), under the summary button or the text panel;
// its tap is a gesture and opens the EffectsCard (onEffects).
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
    readonly dataMap = new Map<string, unknown>()
    constructor() {
      return chain(this)
    }
    // The Button calls these on itself (Container); record what the tests read.
    setVisible(v: boolean): this {
      ;(this as unknown as { visible: boolean }).visible = v
      return this
    }
    setPosition(x: number, y: number): this {
      const o = this as unknown as { x: number; y: number }
      o.x = x
      o.y = y
      return this
    }
    setData(k: string, v: unknown): this {
      this.dataMap.set(k, v)
      return this
    }
    getData(k: string): unknown {
      return this.dataMap.get(k)
    }
    destroy(): void {}
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

const { EFFECTS_ENTRY_TEXT, PausedCard, effectsEntryText } =
  await import('../../src/ui/PausedCard.ts')
const { claimKey, modalCount, popModal, pushModal, topModal } =
  await import('../../src/ui/Sheet.ts')
const { computeLayout } = await import('../../src/ui/layout.ts')

type Fn = (...a: unknown[]) => void

function emitter() {
  let ls: { name: string; fn: Fn; ctx: unknown; once: boolean }[] = []
  const add = (name: string, fn: Fn, ctx: unknown, once: boolean) => {
    ls.push({ name, fn, ctx, once })
  }
  return {
    on: (n: string, fn: Fn, ctx?: unknown) => add(n, fn, ctx, false),
    once: (n: string, fn: Fn, ctx?: unknown) => add(n, fn, ctx, true),
    off: (n: string, fn: Fn, ctx?: unknown) => {
      ls = ls.filter((l) => !(l.name === n && l.fn === fn && l.ctx === ctx))
    },
    emit: (n: string, ...args: unknown[]) => {
      const list = ls.filter((l) => l.name === n)
      ls = ls.filter((l) => !(l.name === n && l.once))
      for (const l of list) l.fn.apply(l.ctx, args)
    },
    count: (n: string) => ls.filter((l) => l.name === n).length,
  }
}

const obj = (): object => chain({})

interface Existing {
  id?: string
  visible?: boolean
  onClick?: (() => void) | null
  getData?: (k: string) => unknown
}

function fakeScene() {
  const existing: Existing[] = []
  return {
    existing,
    scale: { width: 360, height: 604, zoom: 1 },
    add: {
      rectangle: obj,
      zone: obj,
      nineslice: obj,
      bitmapText: obj,
      image: obj,
      container: obj,
      existing: (o: Existing) => {
        existing.push(o)
        return o
      },
    },
    input: { keyboard: emitter() },
    events: emitter(),
    game: { events: emitter() },
    time: { addEvent: () => ({ remove() {} }) },
  }
}

const L = computeLayout(360, 604, 0, 0, 1)

function setup(
  over: { onSummary?: () => void; onEffects?: () => void } = {},
  layout = L,
) {
  const scene = fakeScene()
  const onResume = vi.fn()
  const onGesture = vi.fn()
  // HudScene.resumeFromCard hides the card.
  let card: InstanceType<typeof PausedCard> | null = null
  const c = new PausedCard(scene as never, layout, {
    onGesture,
    onResume: () => {
      onResume()
      card?.hide()
    },
    ...over,
  })
  card = c
  return { scene, card: c, onResume, onGesture }
}

const key = (k: string, repeat = false): KeyboardEvent =>
  ({ key: k, repeat }) as unknown as KeyboardEvent

describe('report §6.5: the Paused card is on the modal stack', () => {
  it('show() puts it on top, hide() takes it off; both are idempotent', () => {
    const { scene, card } = setup()
    const base = modalCount()
    card.show()
    card.show()
    expect(modalCount()).toBe(base + 1)
    expect(topModal()).toBe(card)
    expect(scene.input.keyboard.count('keydown')).toBe(1)
    card.hide()
    card.hide()
    expect(modalCount()).toBe(base)
    expect(topModal()).not.toBe(card)
    expect(scene.input.keyboard.count('keydown')).toBe(0)
  })

  it('under it W, G and the Warehouse Esc-to-City (claimKey(ev, null)) do nothing', () => {
    const { card } = setup()
    card.show()
    for (const k of ['w', 'W', 'g', 'G', 'Escape'])
      expect(claimKey(key(k), null), k).toBe(false)
    card.hide()
    expect(claimKey(key('w'), null)).toBe(modalCount() === 0)
  })

  it('Esc resumes like a tap (inside the audio gesture) and leaves the stack', () => {
    const { scene, card, onResume, onGesture } = setup()
    const base = modalCount()
    const taps: unknown[] = []
    scene.game.events.on('ui:tap', (p: unknown) => taps.push(p))
    card.show()
    const ev = key('Escape')
    scene.input.keyboard.emit('keydown', ev)
    expect(onGesture).toHaveBeenCalledOnce()
    expect(onResume).toHaveBeenCalledOnce()
    expect(taps).toEqual([{ id: 'paused:resume' }])
    expect(card.isOpen()).toBe(false)
    expect(modalCount()).toBe(base)
    // The same Esc never reaches a later listener (the Warehouse's
    // Esc-to-City runs after the HUD's listeners).
    expect(claimKey(ev, null)).toBe(false)
  })

  it('a held Esc (repeat) and every other key pass through the card', () => {
    const { scene, card, onResume } = setup()
    card.show()
    scene.input.keyboard.emit('keydown', key('Escape', true))
    for (const k of [' ', '1', '2', 'w', 'g', 'Enter'])
      scene.input.keyboard.emit('keydown', key(k))
    expect(onResume).not.toHaveBeenCalled()
    expect(card.isOpen()).toBe(true)
    // The HUD routes Space and the speed keys through the card (owner).
    expect(claimKey(key(' '), card)).toBe(true)
    card.hide()
  })

  it('a modal opened above it owns Esc; the card resumes once it is on top again', () => {
    const { scene, card, onResume } = setup()
    card.show()
    const dialog = {}
    pushModal(dialog)
    const ev = key('Escape')
    scene.input.keyboard.emit('keydown', ev)
    expect(onResume).not.toHaveBeenCalled()
    expect(claimKey(ev, dialog)).toBe(true)
    popModal(dialog)
    expect(topModal()).toBe(card)
    scene.input.keyboard.emit('keydown', key('Escape'))
    expect(onResume).toHaveBeenCalledOnce()
  })

  it('opened over a sheet, it sits above it and hands the stack back on close', () => {
    const { card } = setup()
    const sheet = {}
    pushModal(sheet)
    card.show()
    expect(topModal()).toBe(card)
    card.hide()
    expect(topModal()).toBe(sheet)
    popModal(sheet)
  })

  it('scene sleep leaves the stack, wake comes back while open, shutdown cleans up', () => {
    const { scene, card } = setup()
    const base = modalCount()
    card.show()
    scene.events.emit('sleep')
    expect(modalCount()).toBe(base)
    scene.events.emit('wake')
    expect(topModal()).toBe(card)
    scene.events.emit('shutdown')
    expect(modalCount()).toBe(base)
    expect(card.isOpen()).toBe(false)
    expect(scene.input.keyboard.count('keydown')).toBe(0)
    expect(scene.events.count('sleep')).toBe(0)
    expect(scene.events.count('wake')).toBe(0)
    scene.events.emit('wake')
    expect(modalCount()).toBe(base)
  })

  it('a closed card never claims a key', () => {
    const { scene, card, onResume } = setup()
    card.show()
    card.hide()
    scene.input.keyboard.emit('keydown', key('Escape'))
    expect(onResume).not.toHaveBeenCalled()
  })
})

const effectsButton = (scene: ReturnType<typeof fakeScene>) =>
  scene.existing.find((o) => o.id === 'paused:effects')

describe('B3 §3.4: the pause menu Effects · N entry', () => {
  it('without onEffects there is no entry (and setEffectsCount is harmless)', () => {
    const { scene, card } = setup({ onSummary: () => {} })
    card.setEffectsCount(3)
    expect(effectsButton(scene)).toBeUndefined()
    expect(card.effectsCount).toBe(0)
    expect(card.effectsRect()).toBeNull()
  })

  it('hidden until a count is set; 0 hides it, 2 shows `Effects · 2`', () => {
    const onEffects = vi.fn()
    const { scene, card } = setup({ onEffects })
    const b = effectsButton(scene)
    expect(b).toBeDefined()
    expect(b?.visible).toBe(false)
    expect(b?.getData?.('label')).toBe(EFFECTS_ENTRY_TEXT)
    expect(card.effectsRect()).toBeNull()
    card.setEffectsCount(0)
    expect(b?.visible).toBe(false)
    card.setEffectsCount(2)
    expect(b?.visible).toBe(true)
    expect(b?.getData?.('label')).toBe('Effects · 2')
    expect(effectsEntryText(2)).toBe('Effects · 2')
    expect(card.effectsCount).toBe(2)
    expect(card.effectsRect()).not.toBeNull()
    card.setEffectsCount(0)
    expect(b?.visible).toBe(false)
    expect(card.effectsCount).toBe(0)
    expect(card.effectsRect()).toBeNull()
    card.setEffectsCount(Number.NaN)
    expect(b?.visible).toBe(false)
  })

  it('a tap is a gesture first, then onEffects; it never resumes', () => {
    const order: string[] = []
    const onEffects = vi.fn(() => order.push('effects'))
    const scene = fakeScene()
    const onResume = vi.fn()
    const card = new PausedCard(scene as never, L, {
      onGesture: () => order.push('gesture'),
      onResume,
      onEffects,
    })
    card.show()
    card.setEffectsCount(1)
    effectsButton(scene)?.onClick?.()
    expect(onEffects).toHaveBeenCalledOnce()
    expect(order).toEqual(['gesture', 'effects'])
    expect(onResume).not.toHaveBeenCalled()
    card.hide()
  })

  it('it sits under the summary entry (8 px), or under the text panel without one', () => {
    // 360×604: the panel at y 280, the summary entry at 280 + 44 + 16 = 340.
    const both = setup({ onSummary: () => {}, onEffects: () => {} })
    both.card.setEffectsCount(1)
    const s = both.card.entryRect()!
    const e = both.card.effectsRect()!
    expect(s.y).toBe(340)
    expect(e.y).toBe(s.y + s.h + 8)
    expect(e.x).toBe(s.x)
    expect(e.w).toBe(s.w)
    expect(e.h).toBe(44)
    const alone = setup({ onEffects: () => {} })
    alone.card.setEffectsCount(1)
    expect(alone.card.effectsRect()!.y).toBe(340)
  })

  it('it never drops past the safe area (clamped to H − safeBottom − 44)', () => {
    const tight = computeLayout(360, 480, 0, 150, 1)
    const { card } = setup({ onSummary: () => {}, onEffects: () => {} }, tight)
    card.setEffectsCount(4)
    const e = card.effectsRect()!
    expect(e.y).toBe(480 - 150 - 44)
    expect(e.y + e.h).toBeLessThanOrEqual(tight.H - tight.safeBottom)
  })
})
