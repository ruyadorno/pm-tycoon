// Build 3 M12 (B3 §3.4, D-M12-15; M12 contract §4.1, critiques 1 and 17):
// the EffectsCard — the model (the view's newest-first order kept, at most 8
// rows then `+N more`, `<time left> · <card title>` with `permanent` and
// `1d 0h left`, the empty line), the height formula (364 px at 8 rows + more,
// 126 at one), the fit above the bottom bar at 360×604 / 393×659 / 430×932,
// the rows ellipsized to the text column in m5x7, every string's glyphs, the
// world-atlas frames; and the card on a stub scene: the modal stack, Esc /
// Enter / a tap outside / Close → onClose, programmatic close() silent,
// refresh() doing nothing on an unchanged model, re-setting the texts in place
// while the shape holds and rebuilding otherwise, relayout, shutdown. Phaser is
// stubbed with chainable no-op game objects (the card builds a real Button).
import { readFileSync } from 'node:fs'
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
    // Button.destroy calls super.destroy.
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

const ec = await import('../../src/ui/EffectsCard.ts')
const { eventCardRect, modifierIcon } =
  await import('../../src/ui/effectText.ts')
const { computeLayout } = await import('../../src/ui/layout.ts')
const { claimKey, keyClaimed, modalCount, popModal, pushModal, topModal } =
  await import('../../src/ui/Sheet.ts')
const { inAtlas } = await import('../../src/render/frames.ts')
const { MODIFIER_KEYS } = await import('../../src/data/schema.ts')
const { TICKS_PER_DAY } = await import('../../src/sim/types.ts')

import type { ModifierKey } from '../../src/data/types.ts'
import type { ModifierView } from '../../src/sim/view-api.ts'

// ---- m5x7 metrics ---------------------------------------------------------------

const xml = readFileSync(
  new URL('../../src/assets/m5x7.xml', import.meta.url),
  'utf8',
)
const adv = new Map<number, number>()
for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
  adv.set(Number(m[1]), Number(m[2]))
const width = (s: string): number =>
  [...s].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 6), 0)
const missingGlyphs = (s: string): string[] =>
  [...s].filter((ch) => ch !== '\n' && !adv.has(ch.codePointAt(0)!))

// ---- fixtures -------------------------------------------------------------------

const mod = (id: string, over: Partial<ModifierView> = {}): ModifierView => ({
  id,
  key: 'speed',
  line: 'bikes ×0.85 speed',
  untilTick: 600,
  ticksLeft: 600,
  eventId: 'ev_wx_rain',
  label: 'Rain',
  ...over,
})
const many = (n: number): ModifierView[] =>
  Array.from({ length: n }, (_, i) => mod(`m${i}`, { line: `line ${i}` }))

const L360 = computeLayout(360, 604, 0, 0, 1)

// ---- the stub scene ---------------------------------------------------------------

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

/** A recording object (the scrim zone, the root container). */
function rec() {
  const ev = emitter()
  const data = new Map<string, unknown>()
  const o = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    depth: 0,
    visible: true,
    destroyed: false,
    input: { enabled: true, hitArea: { setTo: (..._a: number[]) => {} } },
    setOrigin: () => o,
    setInteractive: () => o,
    setDepth(d: number) {
      o.depth = d
      return o
    },
    setVisible(v: boolean) {
      o.visible = v
      return o
    },
    setPosition(x: number, y: number) {
      o.x = x
      o.y = y
      return o
    },
    setY(y: number) {
      o.y = y
      return o
    },
    setX(x: number) {
      o.x = x
      return o
    },
    setSize(w: number, h: number) {
      o.w = w
      o.h = h
      return o
    },
    add: () => o,
    setData(k: string, v: unknown) {
      data.set(k, v)
      return o
    },
    getData: (k: string) => data.get(k),
    destroy() {
      o.destroyed = true
    },
    on: (n: string, fn: Fn) => ev.on(n, fn),
    emit: (n: string, ...a: unknown[]) => ev.emit(n, ...a),
  }
  return o
}

type Rec = ReturnType<typeof rec>
const obj = (): object => chain({})

interface TweenCfg {
  y: number
  duration: number
  onUpdate?: () => void
  onComplete?: () => void
  targets: { y: number }
}

function fakeScene() {
  const zones: Rec[] = []
  const containers: Rec[] = []
  const existing: { id?: string; onClick?: (() => void) | null }[] = []
  const images: string[] = []
  const texts: { text: string }[] = []
  const tweens: TweenCfg[] = []
  let panels = 0
  const scene = {
    scale: { width: 360, height: 604, zoom: 1 },
    add: {
      zone: () => {
        const z = rec()
        zones.push(z)
        return z
      },
      rectangle: obj,
      nineslice: () => {
        panels++
        return obj()
      },
      bitmapText: (_x: number, _y: number, _f: string, t: string) => {
        const b = chain({
          text: t,
          setText(v: string) {
            this.text = v
            return this
          },
        })
        texts.push(b)
        return b
      },
      image: (_x: number, _y: number, _a: string, f: string) => {
        images.push(f)
        return obj()
      },
      container: () => {
        const c = rec()
        containers.push(c)
        return c
      },
      existing: (o: { id?: string; onClick?: (() => void) | null }) => {
        existing.push(o)
        return o
      },
    },
    tweens: {
      add: (cfg: TweenCfg) => {
        tweens.push(cfg)
        return { stop: () => {} }
      },
      addCounter: () => ({ stop: () => {} }),
    },
    input: { keyboard: emitter() },
    events: emitter(),
    game: { events: emitter() },
    time: { now: 0, addEvent: () => ({ remove() {} }) },
  }
  return {
    scene,
    zones,
    containers,
    existing,
    images,
    texts,
    tweens,
    panels: () => panels,
  }
}

function setup(L = L360) {
  const f = fakeScene()
  const onClose = vi.fn()
  const card = new ec.EffectsCard(f.scene as never, L, { onClose })
  const scrim = f.zones[0]!
  const root = f.containers[0]!
  const closeButton = () =>
    f.existing.filter((o) => o.id === ec.EFFECTS_CLOSE_ID).at(-1)
  return { ...f, card, onClose, scrim, root, closeButton }
}

const key = (k: string, repeat = false): KeyboardEvent =>
  ({ key: k, repeat }) as unknown as KeyboardEvent
const pointer = (d = 0) => ({ getDistance: () => d })

// ---- the model --------------------------------------------------------------------

describe('B3 §3.4: the EffectsCard model', () => {
  it("keeps the view's order (newest first: critique 1), at most 8 rows, then +N more", () => {
    const m = ec.effectsCardModel(many(10))
    expect(m.rows.map((r) => r.line)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `line ${i}`),
    )
    expect(m.rows).toHaveLength(ec.EFFECTS_MAX_ROWS)
    expect(m.more).toBe('+2 more')
    expect(m.count).toBe('10 active')
    expect(m.empty).toBeNull()
    expect(ec.effectsCardModel(many(8)).more).toBeNull()
    expect(ec.effectsCardModel(many(9)).more).toBe('+1 more')
  })

  it('each row: the icon for its key, the sim line, `<time left> · <card title>`', () => {
    const m = ec.effectsCardModel([
      mod('a', { ticksLeft: TICKS_PER_DAY }),
      mod('b', {
        key: 'income',
        line: 'income ×1.10',
        untilTick: null,
        ticksLeft: null,
        label: 'Small-business grant',
      }),
    ])
    expect(m.rows[0]).toEqual({
      icon: modifierIcon('speed'),
      line: 'bikes ×0.85 speed',
      sub: '1d 0h left · Rain',
    })
    expect(m.rows[1]).toEqual({
      icon: modifierIcon('income'),
      line: 'income ×1.10',
      sub: 'permanent · Small-business grant',
    })
    expect(m.count).toBe('2 active')
  })

  it('nothing live: the empty line, no rows', () => {
    const m = ec.effectsCardModel([])
    expect(m).toEqual({
      count: '0 active',
      rows: [],
      more: null,
      empty: ec.EFFECTS_EMPTY_TEXT,
    })
  })
})

describe('the geometry', () => {
  it('the height: 34 + 32·rows (or 14 empty) + 14 for +N more + 8 + 44 + 8', () => {
    const h = (n: number) => ec.effectsCardHeight(ec.effectsCardModel(many(n)))
    expect(h(12)).toBe(364)
    expect(h(9)).toBe(364)
    expect(h(8)).toBe(350)
    expect(h(1)).toBe(126)
    expect(h(0)).toBe(108)
    const m = ec.effectsCardModel(many(12))
    expect(ec.effectsListBottom(m)).toBe(34 + 8 * 32 + 14)
    expect(ec.effectsCloseY(m)).toBe(ec.effectsListBottom(m) + 8)
    expect(ec.effectsRowY(0)).toBe(34)
    expect(ec.effectsRowY(7)).toBe(34 + 7 * 32)
  })

  it('the tallest card sits 8 px above the bottom bar, under the ticker, at every phone size', () => {
    const h = ec.effectsCardHeight(ec.effectsCardModel(many(20)))
    for (const [W, H, st, sb] of [
      [360, 604, 0, 0],
      [393, 659, 0, 0],
      [393, 852, 59, 34],
      [430, 932, 0, 0],
    ] as const) {
      const L = computeLayout(W, H, st, sb, 1)
      const r = eventCardRect(L, h)
      expect(r.y, `${W}x${H}`).toBeGreaterThanOrEqual(L.ticker.y + L.ticker.h)
      expect(r.y + r.h, `${W}x${H}`).toBe(L.bottomBar.y - 8)
      expect(r.w).toBe(300)
      expect(r.x).toBe(Math.round((W - 300) / 2))
    }
    // The room at 360×604 is 532 − 64 = 468.
    expect(L360.bottomBar.y - 8 - (L360.ticker.y + L360.ticker.h)).toBe(468)
  })

  it('the text column is w − 12 − 32 (256 at 300); long rows ellipsize to it in m5x7', () => {
    expect(ec.effectsTextW(300)).toBe(256)
    const short = ec.fitEffectsRow(
      {
        icon: 'ic_speed2',
        line: 'bikes ×0.85 speed',
        sub: '1d 0h left · Rain',
      },
      256,
      width,
    )
    expect(short).toEqual({
      line: 'bikes ×0.85 speed',
      sub: '1d 0h left · Rain',
    })
    const long = ec.fitEffectsRow(
      {
        icon: 'ic_money',
        line: 'payroll ×1.25 for every inspector, driver and the sorter crew',
        sub: 'permanent · The investor who wanted a seat on the board',
      },
      256,
      width,
    )
    for (const s of [long.line, long.sub]) {
      expect(s.endsWith('…'), s).toBe(true)
      expect(width(s), s).toBeLessThanOrEqual(256)
    }
  })
})

describe('glyphs and frames', () => {
  it('every string the card draws has its glyphs in m5x7', () => {
    for (const s of [
      ec.EFFECTS_TITLE,
      ec.EFFECTS_EMPTY_TEXT,
      ec.EFFECTS_CLOSE_TEXT,
      '12 active',
      '+4 more',
      'permanent · Rain',
      '1d 0h left · Rain',
      '23h left · Rain',
      '<1h left · Rain',
      'bikes ×0.85 speed',
      '…',
    ])
      expect(missingGlyphs(s), s).toEqual([])
  })

  it('every frame the card draws is packed into world (the HUD binds world only)', () => {
    for (const f of [
      ec.EFFECTS_ICON,
      'ui_panel',
      'ui_btn',
      'ui_btn_down',
      ...(MODIFIER_KEYS as readonly ModifierKey[]).map(modifierIcon),
    ])
      expect(inAtlas(f, 'world'), f).toBe(true)
  })

  it('the row icons draw on a plate (critique 17): every row gets one, the image on it', () => {
    const { card, images } = setup()
    card.open([
      mod('a', { key: 'machineP' }),
      mod('b', { key: 'speed' }),
      mod('c', { key: 'income' }),
    ])
    expect(images).toEqual([
      ec.EFFECTS_ICON,
      modifierIcon('machineP'),
      modifierIcon('speed'),
      modifierIcon('income'),
    ])
    expect(ec.EFFECTS_PLATE).toBe(18)
    card.close()
  })
})

// ---- the card ---------------------------------------------------------------------

describe('the card: the modal stack and its dismissals', () => {
  it('open puts it on top and registers keys; the model and rect follow the mods', () => {
    const { card, scene, root, scrim } = setup()
    const base = modalCount()
    expect(card.isOpen).toBe(false)
    expect(card.rect).toBeNull()
    expect(scrim.visible).toBe(false)
    expect(scrim.input.enabled).toBe(false)
    card.open([mod('a')])
    card.open([mod('a')])
    expect(card.isOpen).toBe(true)
    expect(modalCount()).toBe(base + 1)
    expect(topModal()).toBe(card)
    expect(scene.input.keyboard.count('keydown')).toBe(1)
    expect(card.model?.rows).toHaveLength(1)
    expect(card.rect).toEqual({ x: 30, y: 540 - 8 - 126, w: 300, h: 126 })
    expect(root.visible).toBe(true)
    expect(root.x).toBe(30)
    expect(scrim.visible).toBe(true)
    expect(scrim.input.enabled).toBe(true)
    expect(scrim.getData('id')).toBe(ec.EFFECTS_SCRIM_ID)
    card.close()
    expect(modalCount()).toBe(base)
    expect(scene.input.keyboard.count('keydown')).toBe(0)
    expect(scrim.input.enabled).toBe(false)
    expect(root.visible).toBe(false)
  })

  it('it slides up from the bottom into its rect', () => {
    const { card, root, tweens } = setup()
    card.open([mod('a')])
    expect(tweens).toHaveLength(1)
    const t = tweens[0]!
    expect(t.duration).toBe(300)
    expect(t.y).toBe(406)
    expect(root.y).toBe(604)
    t.targets.y = 500
    t.onUpdate?.()
    expect(root.y).toBe(500)
    t.onComplete?.()
    expect(root.y).toBe(406)
    card.close()
  })

  it('Esc closes it and calls onClose once (claimed); a repeat is swallowed', () => {
    const { card, scene, onClose } = setup()
    const base = modalCount()
    card.open([mod('a')])
    const rep = key('Escape', true)
    scene.input.keyboard.emit('keydown', rep)
    expect(onClose).not.toHaveBeenCalled()
    expect(keyClaimed(rep)).toBe(true)
    const ev = key('Escape')
    scene.input.keyboard.emit('keydown', ev)
    expect(onClose).toHaveBeenCalledOnce()
    expect(card.isOpen).toBe(false)
    expect(modalCount()).toBe(base)
    expect(claimKey(ev, null)).toBe(false)
  })

  it('Enter closes it too; other keys pass', () => {
    const { card, scene, onClose } = setup()
    card.open([])
    for (const k of [' ', 'w', 'g', '1']) {
      const ev = key(k)
      scene.input.keyboard.emit('keydown', ev)
      expect(keyClaimed(ev), k).toBe(false)
    }
    expect(onClose).not.toHaveBeenCalled()
    scene.input.keyboard.emit('keydown', key('Enter'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(card.isOpen).toBe(false)
  })

  it('a modal above it owns Esc', () => {
    const { card, scene, onClose } = setup()
    card.open([mod('a')])
    const dialog = {}
    pushModal(dialog)
    const ev = key('Escape')
    scene.input.keyboard.emit('keydown', ev)
    expect(onClose).not.toHaveBeenCalled()
    expect(claimKey(ev, dialog)).toBe(true)
    popModal(dialog)
    scene.input.keyboard.emit('keydown', key('Escape'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a tap outside (on the scrim) closes it; a drag does not', () => {
    const { card, scrim, onClose } = setup()
    card.open([mod('a')])
    scrim.emit('pointerdown')
    scrim.emit('pointerup', pointer(40))
    expect(onClose).not.toHaveBeenCalled()
    scrim.emit('pointerup', pointer(0))
    expect(onClose).not.toHaveBeenCalled()
    scrim.emit('pointerdown')
    scrim.emit('pointerup', pointer(2))
    expect(onClose).toHaveBeenCalledOnce()
    expect(card.isOpen).toBe(false)
  })

  it('Close (effects:close) closes it and calls onClose', () => {
    const { card, onClose, closeButton } = setup()
    card.open([mod('a'), mod('b')])
    const b = closeButton()
    expect(b).toBeDefined()
    b?.onClick?.()
    expect(onClose).toHaveBeenCalledOnce()
    expect(card.isOpen).toBe(false)
  })

  it('a programmatic close() calls nothing', () => {
    const { card, onClose } = setup()
    card.open([mod('a')])
    card.close()
    card.close()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('refresh, relayout, shutdown', () => {
  it('refresh: nothing on an unchanged model, texts in place while the shape holds, else a rebuild', () => {
    const { card, panels, texts, closeButton } = setup()
    card.refresh([mod('a')])
    expect(card.isOpen).toBe(false)
    expect(panels()).toBe(0)
    card.open([mod('a')])
    expect(panels()).toBe(1)
    const close = closeButton()
    card.refresh([mod('a')])
    expect(panels()).toBe(1)
    // Time left ticked: the same children (a Close press survives it).
    card.refresh([mod('a', { ticksLeft: 300 })])
    expect(panels()).toBe(1)
    expect(closeButton()).toBe(close)
    expect(card.model?.rows[0]?.sub).toBe('12h left · Rain')
    expect(texts.some((t) => t.text === '12h left · Rain')).toBe(true)
    // Another row: a rebuild at the new height.
    card.refresh(many(10))
    expect(panels()).toBe(2)
    expect(closeButton()).not.toBe(close)
    expect(card.rect?.h).toBe(364)
    expect(card.rect?.y).toBe(540 - 8 - 364)
    // `+2 more` → `+3 more` keeps the shape: in place.
    card.refresh(many(11))
    expect(panels()).toBe(2)
    expect(texts.some((t) => t.text === '+3 more')).toBe(true)
    expect(texts.some((t) => t.text === '11 active')).toBe(true)
    card.refresh([])
    expect(panels()).toBe(3)
    expect(card.model?.empty).toBe(ec.EFFECTS_EMPTY_TEXT)
    expect(card.rect?.h).toBe(108)
    expect(card.isOpen).toBe(true)
    card.close()
  })

  it('relayout keeps it open and on top at the new canvas', () => {
    const { card, scrim } = setup()
    card.open([mod('a')])
    const L = computeLayout(393, 659, 0, 0, 1)
    card.relayout(L)
    expect(card.isOpen).toBe(true)
    expect(topModal()).toBe(card)
    expect([scrim.w, scrim.h]).toEqual([393, 659])
    expect(card.rect).toEqual({
      x: Math.round((393 - 300) / 2),
      y: L.bottomBar.y - 8 - 126,
      w: 300,
      h: 126,
    })
    card.close()
  })

  it('a scene shutdown destroys it and leaves the stack', () => {
    const { card, scene, scrim, root, onClose } = setup()
    const base = modalCount()
    card.open([mod('a')])
    scene.events.emit('shutdown')
    expect(card.isOpen).toBe(false)
    expect(modalCount()).toBe(base)
    expect(scene.input.keyboard.count('keydown')).toBe(0)
    expect(scrim.destroyed).toBe(true)
    expect(root.destroyed).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    card.open([mod('a')])
    expect(card.isOpen).toBe(false)
    card.destroy()
  })
})
