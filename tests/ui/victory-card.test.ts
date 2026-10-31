// M7 VictoryCard (spec-build2 §3.4; design-m7 §6.6, §7 "victory-card";
// plan-build2 §8.4 task 4): `TYCOON`, the puns tickerQuest.victory line and
// the run stats — days, lifetime earned, parcels delivered, malware caught /
// missed, lives, level reached — the card's height at 360×604, and the card
// on a stub scene: on top of the modal stack with its own camera, Enter / Esc
// = Continue, closing removes the camera. Phaser is stubbed with chainable
// no-op game objects (the card builds real kit Buttons). Build 3 M12 (B3 §5,
// D-M12-12): the 208×104 `victory_art` drawn 1:1 under TYCOON (the card
// grows 112 px and still fits 360×604) and the confetti burst — one scene
// timer on `open(m, {burst: true})`, none on a relayout, stopped before the
// container goes.
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
const { inAtlas } = await import('../../src/render/frames.generated.ts')
const { CONFETTI_LIFT, CONFETTI_PIECES } =
  await import('../../src/ui/confetti.ts')

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

describe('design-m7 §6.6 / B3 §5: the card fits 360×604 with the victory art (454 px)', () => {
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
    // Without the art (no frame): the build-2 card, ≈ 340 px.
    const bare = vc.victoryCardHeight(lines.length, m.stats.length, false)
    expect(bare).toBeGreaterThan(300)
    expect(bare).toBeLessThanOrEqual(360)
    // B3 §5: the art adds 104 + 8 and the card still fits 360×604.
    const h = vc.victoryCardHeight(lines.length, m.stats.length, true)
    expect(h).toBe(bare + vc.VICTORY_ART_H + vc.VICTORY_ART_GAP)
    expect(vc.victoryCardHeight(2, 6)).toBe(454)
    expect(h).toBeGreaterThan(400)
    for (const [W, H] of [
      [360, 604],
      [393, 659],
      [430, 932],
    ] as const) {
      const L = computeLayout(W, H, 0, 0, 1)
      expect(h, `${W}×${H}`).toBeLessThanOrEqual(L.H - L.safeTop - L.safeBottom)
    }
    // The 208-px art fits the card's inner width at 360 (288).
    expect(inner).toBe(288)
    expect(vc.VICTORY_ART_W).toBeLessThanOrEqual(inner)
    expect([vc.VICTORY_ART_W, vc.VICTORY_ART_H]).toEqual([208, 104])
  })

  it('victory_art and the confetti frames are packed in the world atlas', () => {
    expect(inAtlas('victory_art', 'world')).toBe(true)
    for (let f = 0; f < 8; f++)
      expect(inAtlas(`fx_confetti_f${f}`, 'world'), `f${f}`).toBe(true)
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
  const images: { x: number; y: number; frame: string }[] = []
  const timerRemove = vi.fn()
  const addEvent = vi.fn(() => ({ remove: timerRemove }))
  const scene = {
    scale: { width: 360, height: 604, zoom: 1 },
    add: {
      rectangle: obj,
      nineslice: obj,
      bitmapText: obj,
      image: (x: number, y: number, _atlas: string, frame: string) => {
        images.push({ x, y, frame })
        return chain({})
      },
      container: obj,
      existing: (o: unknown) => o,
    },
    time: { addEvent },
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
  return { scene, added, removed, images, addEvent, timerRemove }
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

describe('B3 §5 / D-M12-12: the victory art and the confetti burst on the card', () => {
  const L = computeLayout(360, 604, 0, 0, 1)
  const opts = { onContinue: vi.fn(), onNewGame: vi.fn() }

  it('draws victory_art 1:1, centred, right under TYCOON; no burst without the option', () => {
    const { scene, images, addEvent } = fakeScene()
    const card = new vc.VictoryCard(scene as never, L, data, opts)
    card.open(vc.victoryModel(INPUT, data))
    const art = images.filter((i) => i.frame === 'victory_art')
    expect(art).toHaveLength(1)
    expect(art[0]!.x).toBe(Math.round((360 - vc.VICTORY_ART_W) / 2))
    // The stub's headline wraps to 2 lines: the card is 454 px, centred in
    // the safe area, and the art starts PAD + TITLE_H + 10 below its top.
    const ch = vc.victoryCardHeight(2, 6)
    const cy = L.safeTop + Math.round((L.H - L.safeTop - L.safeBottom - ch) / 2)
    expect(art[0]!.y).toBe(cy + 16 + 28 + 10)
    expect(addEvent).not.toHaveBeenCalled()
    expect(card.bursting).toBe(false)
    card.close()
  })

  it('open(m, {burst: true}) starts one burst over the top edge; a relayout neither replays nor keeps it; close stops it', () => {
    const { scene, images, addEvent, timerRemove } = fakeScene()
    const card = new vc.VictoryCard(scene as never, L, data, opts)
    card.open(vc.victoryModel(INPUT, data), { burst: true })
    expect(addEvent).toHaveBeenCalledTimes(1)
    expect(card.bursting).toBe(true)
    const ch = vc.victoryCardHeight(2, 6)
    const cy = L.safeTop + Math.round((L.H - L.safeTop - L.safeBottom - ch) / 2)
    const pieces = images.filter((i) => i.frame === 'fx_confetti_f0')
    expect(pieces.map((p) => p.x)).toEqual(
      CONFETTI_PIECES.map((p) => 180 + p.dx),
    )
    expect(pieces.every((p) => p.y === cy - CONFETTI_LIFT)).toBe(true)
    // A relayout rebuilds with no burst: the running one stops first.
    card.relayout(computeLayout(393, 659, 0, 0, 1))
    expect(addEvent).toHaveBeenCalledTimes(1)
    expect(timerRemove).toHaveBeenCalledTimes(1)
    expect(card.bursting).toBe(false)
    card.close()
    expect(timerRemove).toHaveBeenCalledTimes(1)

    // Closing while it runs stops it (before the root is destroyed).
    const b = fakeScene()
    const c2 = new vc.VictoryCard(b.scene as never, L, data, opts)
    c2.open(vc.victoryModel(INPUT, data), { burst: true })
    expect(b.addEvent).toHaveBeenCalledTimes(1)
    c2.close()
    expect(b.timerRemove).toHaveBeenCalledTimes(1)
    expect(c2.bursting).toBe(false)
  })
})
