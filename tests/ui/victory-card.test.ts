// M7 VictoryCard (spec-build2 §3.4; design-m7 §6.6, §7 "victory-card";
// plan-build2 §8.4 task 4): `TYCOON`, the puns tickerQuest.victory line and
// the run stats — days, lifetime earned, parcels delivered, malware caught /
// missed, lives, level reached — the card's height at 360×604, and the card
// on a stub scene: on top of the modal stack with its own camera, Enter / Esc
// = Continue, closing removes the camera. Phaser is stubbed with chainable
// no-op game objects (the card builds real kit Buttons).
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

type Bag = Record<string | symbol, unknown>

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
      if (k === 'getTextBounds') return () => ({ lines: { lengths: [1, 1] } })
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
    destroy(): void {}
  }
  class Rectangle {
    readonly stub = true
  }
  return {
    default: {
      Scene: GameObject,
      GameObjects: {
        Container: GameObject,
        NineSlice: GameObject,
        Image: GameObject,
      },
      Geom: { Rectangle },
    },
  }
})

const vc = await import('../../src/ui/VictoryCard.ts')
const { wrapHeadline } = await import('../../src/ui/Newspaper.ts')
const { computeLayout } = await import('../../src/ui/layout.ts')
const { modalCount, topModal } = await import('../../src/ui/Sheet.ts')
const { dataFixture } = await import('../sim/helpers.ts')

const data = dataFixture()

const INPUT = {
  day: 41,
  lifetimeEarned: 16420,
  deliveries: 912,
  malwareMissed: 2,
  defused: 57,
  lives: 4,
  level: 5,
  victoryTick: 41 * 600 + 300,
}

describe('spec-build2 §3.4: TYCOON and the run stats', () => {
  it('days, lifetime earned, clean deliveries, caught / missed, lives of the cap, level reached', () => {
    const m = vc.victoryModel(INPUT, data)
    expect(m.title).toBe('TYCOON')
    const l5 = data.levels.find((l) => l.level === 5)!
    expect(m.stats).toEqual([
      ['Days', '41'],
      ['Lifetime earned', '$16,420'],
      ['Parcels delivered', '910'],
      ['Malware caught / missed', '57 / 2'],
      ['Lives', `4 of ${data.economy.lives.cap}`],
      ['Level reached', `Lv5 ${l5.title}`],
    ])
  })

  it('the headline is the puns tickerQuest.victory line with the company', () => {
    expect(vc.victoryModel(INPUT, data).headline).toBe(
      'The Golden Release ships — Node Heights Courier is a Tycoon!',
    )
  })

  it('never shows a negative delivery count; the victory day is Day N of the victory tick', () => {
    const m = vc.victoryModel(
      { ...INPUT, deliveries: 1, malwareMissed: 3 },
      data,
    )
    expect(m.stats[2]).toEqual(['Parcels delivered', '0'])
    expect(vc.victoryDay(INPUT.victoryTick)).toBe(42)
    expect(vc.victoryDay(0)).toBe(1)
  })
})

describe('design-m7 §6.6: the card fits 360×604 (≈ 340 px tall)', () => {
  const xml = readFileSync(
    new URL('../../src/assets/m5x7.xml', import.meta.url),
    'utf8',
  )
  const adv = new Map<number, number>()
  for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
    adv.set(Number(m[1]), Number(m[2]))
  const width = (s: string): number =>
    [...s].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 6), 0)

  it('the headline wraps to at most 2 lines and every stats row fits the card at 360', () => {
    const m = vc.victoryModel(INPUT, data)
    const inner = Math.min(vc.VICTORY_CARD_MAX_W, 360 - 16) - 32
    const lines = wrapHeadline(m.headline, inner, 3, width)
    expect(lines.length).toBeLessThanOrEqual(2)
    for (const [label, value] of m.stats)
      expect(width(label) + 8 + width(value)).toBeLessThanOrEqual(inner)
    const h = vc.victoryCardHeight(lines.length, m.stats.length)
    expect(h).toBeGreaterThan(300)
    expect(h).toBeLessThanOrEqual(360)
    const L = computeLayout(360, 604, 0, 0, 1)
    expect(h).toBeLessThanOrEqual(L.H - L.safeTop - L.safeBottom)
  })
})

function emitter() {
  const ls = new Map<
    string,
    { fn: (...a: unknown[]) => void; ctx: unknown }[]
  >()
  return {
    on: (n: string, fn: (...a: unknown[]) => void, ctx?: unknown) => {
      ls.set(n, [...(ls.get(n) ?? []), { fn, ctx }])
    },
    once: (n: string, fn: (...a: unknown[]) => void, ctx?: unknown) => {
      ls.set(n, [...(ls.get(n) ?? []), { fn, ctx }])
    },
    off: (n: string, fn: (...a: unknown[]) => void, ctx?: unknown) => {
      ls.set(
        n,
        (ls.get(n) ?? []).filter((l) => !(l.fn === fn && l.ctx === ctx)),
      )
    },
    emit: (n: string, ...args: unknown[]) => {
      for (const l of (ls.get(n) ?? []).slice()) l.fn.call(l.ctx, ...args)
    },
  }
}

const obj = (): object => chain({})

function fakeScene() {
  const added: unknown[] = []
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
      add: () => {
        const c = chain({})
        added.push(c)
        return c
      },
      remove: (c: unknown) => removed.push(c),
    },
    children: { list: [] as unknown[] },
    input: { keyboard: emitter() },
    events: emitter(),
    game: { events: emitter() },
  }
  return { scene, added, removed }
}

const key = (k: string) => ({ key: k, repeat: false }) as KeyboardEvent

describe('design-m7 §6.6: the card (modal, its own camera, Enter = Continue)', () => {
  it('opens on top of the modal stack; Enter and Esc are Continue; New game is never a key', () => {
    const { scene, added, removed } = fakeScene()
    const onContinue = vi.fn()
    const onNewGame = vi.fn()
    const onSummary = vi.fn()
    const card = new vc.VictoryCard(
      scene as never,
      computeLayout(360, 604, 0, 0, 1),
      data,
      { onContinue, onNewGame, onSummary },
    )
    expect(card.isOpen).toBe(false)
    const before = modalCount()
    card.open(vc.victoryModel(INPUT, data))
    expect(card.isOpen).toBe(true)
    expect(card.current?.title).toBe('TYCOON')
    expect(modalCount()).toBe(before + 1)
    expect(topModal()).toBe(card)
    expect(added).toHaveLength(1)
    scene.input.keyboard.emit('keydown', key('Enter'))
    expect(onContinue).toHaveBeenCalledTimes(1)
    scene.input.keyboard.emit('keydown', key('Escape'))
    expect(onContinue).toHaveBeenCalledTimes(2)
    expect(onNewGame).not.toHaveBeenCalled()
    expect(onSummary).not.toHaveBeenCalled()
    // A relayout rebuilds on a fresh camera.
    card.relayout(computeLayout(393, 659, 0, 0, 1))
    expect(added).toHaveLength(2)
    expect(removed).toContain(added[0])
    card.close()
    expect(card.isOpen).toBe(false)
    expect(modalCount()).toBe(before)
    expect(removed).toContain(added[1])
    // Closed: the keys no longer reach it.
    scene.input.keyboard.emit('keydown', key('Enter'))
    expect(onContinue).toHaveBeenCalledTimes(2)
    card.destroy()
  })
})
