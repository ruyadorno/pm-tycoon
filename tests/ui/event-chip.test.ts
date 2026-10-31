// Build 3 M12 (B3 §3.4; M12 contract §3.2, critique 8): the HUD row-B event
// chip — the model (visible while a modifier is live or a card waits, pulses
// only while a card waits and never once the game is over), the one-glyph
// count (`''`, `1`…`9`, `+`), the icon centred without a count, and the chip
// on a stub scene: the tap zone a scene child with the id 'eventChip' (e2e
// tapTarget), enabled only while visible; the 1-Hz pulse on the scene clock;
// destroy removes the update listener. World-atlas frames only. Phaser is
// stubbed (the chip imports it as a type only; the stub keeps any
// transitive value import inert).
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({ default: {} }))

const {
  EVENT_CHIP_COUNT_X,
  EVENT_CHIP_FRAME,
  EVENT_CHIP_HIDDEN,
  EVENT_CHIP_ICON_X,
  EVENT_CHIP_ID,
  EventChip,
  eventChipCountText,
  eventChipIconX,
  eventChipModel,
} = await import('../../src/ui/EventChip.ts')
const { EVENT_CHIP_W, ROW_H } = await import('../../src/ui/layout.ts')
const { QUEST_PULSE_ALPHA, QUEST_PULSE_MS } =
  await import('../../src/ui/QuestChip.ts')
const { inAtlas } = await import('../../src/render/frames.ts')

import type { ModifierView } from '../../src/sim/view-api.ts'

type Fn = (...a: unknown[]) => void

function emitter() {
  let ls: { name: string; fn: Fn; ctx: unknown }[] = []
  return {
    on(n: string, fn: Fn, ctx?: unknown) {
      ls.push({ name: n, fn, ctx })
      return this
    },
    once(n: string, fn: Fn, ctx?: unknown) {
      ls.push({ name: n, fn, ctx })
      return this
    },
    off(n: string, fn: Fn, ctx?: unknown) {
      ls = ls.filter((l) => !(l.name === n && l.fn === fn && l.ctx === ctx))
      return this
    },
    emit(n: string, ...args: unknown[]) {
      for (const l of ls.filter((x) => x.name === n)) l.fn.apply(l.ctx, args)
      return true
    },
    count: (n: string) => ls.filter((l) => l.name === n).length,
  }
}

/** A recording game object: the setters the chip calls store their values. */
function rec(init: Record<string, unknown> = {}) {
  const ev = emitter()
  const data = new Map<string, unknown>()
  const o = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    depth: 0,
    alpha: 1,
    visible: true,
    text: '',
    width: 0,
    destroyed: false,
    input: { enabled: true, hitArea: { setTo: () => undefined } } as {
      enabled: boolean
      hitArea: { setTo: (...a: number[]) => void }
    },
    ...init,
    setOrigin() {
      return o
    },
    setInteractive() {
      return o
    },
    setPosition(x: number, y: number) {
      o.x = x
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
    setDepth(d: number) {
      o.depth = d
      return o
    },
    setAlpha(a: number) {
      o.alpha = a
      return o
    },
    setVisible(v: boolean) {
      o.visible = v
      return o
    },
    setTint() {
      return o
    },
    setFrame() {
      return o
    },
    setText(t: string) {
      o.text = t
      o.width = 6 * t.length
      return o
    },
    setData(k: string, v: unknown) {
      data.set(k, v)
      return o
    },
    getData(k: string) {
      return data.get(k)
    },
    destroy() {
      o.destroyed = true
    },
    on: ev.on.bind(ev),
    emit: ev.emit.bind(ev),
  }
  return o
}

type Rec = ReturnType<typeof rec>

function fakeScene() {
  const zones: Rec[] = []
  const containers: Rec[] = []
  const images: Rec[] = []
  const texts: Rec[] = []
  const taps: unknown[] = []
  const game = { events: emitter() }
  game.events.on('ui:tap', (p: unknown) => taps.push(p))
  const scene = {
    add: {
      zone: (x: number, y: number, w: number, h: number) => {
        const z = rec({ x, y, w, h })
        zones.push(z)
        return z
      },
      image: (x: number, y: number) => {
        const i = rec({ x, y })
        images.push(i)
        return i
      },
      bitmapText: (x: number, y: number, _f: string, t: string) => {
        const b = rec({ x, y })
        b.setText(t)
        texts.push(b)
        return b
      },
      container: () => {
        const c = rec()
        containers.push(c)
        return c
      },
    },
    time: { now: 0 },
    events: emitter(),
    game,
  }
  return { scene, zones, containers, images, texts, taps }
}

const mod = (id: string): ModifierView => ({
  id,
  key: 'speed',
  line: 'bikes ×0.85 speed',
  untilTick: 600,
  ticksLeft: 600,
  eventId: 'ev_wx_rain',
  label: 'Rain',
})
const mods = (n: number) => ({
  modifiers: Array.from({ length: n }, (_, i) => mod(`m${i}`)),
})

const pointer = (d = 0) => ({ getDistance: () => d })

describe('B3 §3.4: the event chip model', () => {
  it('hidden with no modifier and no waiting card', () => {
    expect(eventChipModel(mods(0), false)).toEqual(EVENT_CHIP_HIDDEN)
  })

  it('a live modifier shows it (the count), still', () => {
    expect(eventChipModel(mods(2), false)).toEqual({
      visible: true,
      count: 2,
      pulse: false,
    })
  })

  it('a waiting card shows it and pulses, with or without modifiers', () => {
    expect(eventChipModel(mods(0), true)).toEqual({
      visible: true,
      count: 0,
      pulse: true,
    })
    expect(eventChipModel(mods(3), true)).toEqual({
      visible: true,
      count: 3,
      pulse: true,
    })
  })

  it('never pulses at game over (critique 8): only the modifiers keep it up', () => {
    expect(eventChipModel(mods(0), true, true)).toEqual(EVENT_CHIP_HIDDEN)
    expect(eventChipModel(mods(1), true, true)).toEqual({
      visible: true,
      count: 1,
      pulse: false,
    })
    expect(eventChipModel(mods(1), false, true).pulse).toBe(false)
  })
})

describe('the count glyph and the icon', () => {
  it("'' at 0, 1…9, + from 10 (one glyph), junk reads 0", () => {
    expect(eventChipCountText(0)).toBe('')
    for (let n = 1; n <= 9; n++) expect(eventChipCountText(n)).toBe(String(n))
    for (const n of [10, 11, 99, 1000]) expect(eventChipCountText(n)).toBe('+')
    for (const n of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(eventChipCountText(n)).toBe('')
    expect(eventChipCountText(2.7)).toBe('2')
  })

  it('the icon sits at x 1 beside a count, centred (x 4) without one', () => {
    expect(EVENT_CHIP_W).toBe(24)
    expect(eventChipIconX('3')).toBe(EVENT_CHIP_ICON_X)
    expect(EVENT_CHIP_ICON_X).toBe(1)
    expect(eventChipIconX('')).toBe(4)
    expect(EVENT_CHIP_COUNT_X).toBe(17)
  })

  it('every count glyph is in m5x7 and fits the 24-px chip after the icon', () => {
    const xml = readFileSync(
      new URL('../../src/assets/m5x7.xml', import.meta.url),
      'utf8',
    )
    const adv = new Map<number, number>()
    for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
      adv.set(Number(m[1]), Number(m[2]))
    for (const s of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+']) {
      const cp = s.codePointAt(0)!
      expect(adv.has(cp), s).toBe(true)
      expect(EVENT_CHIP_COUNT_X + adv.get(cp)!, s).toBeLessThanOrEqual(
        EVENT_CHIP_W,
      )
    }
  })

  it('ic_event is a world frame (the HUD binds world only)', () => {
    expect(inAtlas(EVENT_CHIP_FRAME, 'world')).toBe(true)
  })
})

function build() {
  const f = fakeScene()
  const chip = new EventChip(f.scene as never)
  const zone = f.zones[0]!
  const root = f.containers[0]!
  const icon = f.images[0]!
  const count = f.texts[0]!
  return { ...f, chip, zone, root, icon, count }
}

describe('the chip on a stub scene', () => {
  it("its tap zone is a scene child with the id 'eventChip', off while hidden", () => {
    const { chip, zone, root, icon } = build()
    expect(EVENT_CHIP_ID).toBe('eventChip')
    expect(zone.getData('id')).toBe('eventChip')
    expect(zone.input.enabled).toBe(false)
    expect(zone.visible).toBe(false)
    expect(root.visible).toBe(false)
    expect(chip.visible).toBe(false)
    expect(chip.current).toEqual(EVENT_CHIP_HIDDEN)
    expect(icon.y).toBe(Math.floor((ROW_H - 16) / 2))
  })

  it('set() shows the icon and the count; the rect places the visuals and the zone', () => {
    const { chip, zone, root, icon, count } = build()
    chip.setRect(
      { x: 270, y: 24, w: 24, h: 24 },
      { x: 266, y: 24, w: 44, h: 44 },
    )
    chip.set(eventChipModel(mods(3), false))
    expect(root.visible).toBe(true)
    expect(zone.visible).toBe(true)
    expect(zone.input.enabled).toBe(true)
    expect([root.x, root.y]).toEqual([270, 24])
    expect([zone.x, zone.y, zone.w, zone.h]).toEqual([266, 24, 44, 44])
    expect(count.text).toBe('3')
    expect(count.visible).toBe(true)
    expect(icon.x).toBe(1)
    chip.set(eventChipModel(mods(0), true))
    expect(count.text).toBe('')
    expect(count.visible).toBe(false)
    expect(icon.x).toBe(4)
    chip.set(EVENT_CHIP_HIDDEN)
    expect(root.visible).toBe(false)
    expect(zone.input.enabled).toBe(false)
  })

  it('a tap on the zone emits ui:tap {id: eventChip} and calls onTap', () => {
    const { chip, zone, taps } = build()
    const onTap = vi.fn()
    chip.onTap(onTap)
    chip.set(eventChipModel(mods(1), false))
    zone.emit('pointerdown')
    zone.emit('pointerup', pointer(2))
    expect(onTap).toHaveBeenCalledOnce()
    expect(taps).toEqual([{ id: 'eventChip' }])
    // A drag is no tap.
    zone.emit('pointerdown')
    zone.emit('pointerup', pointer(30))
    expect(onTap).toHaveBeenCalledOnce()
  })

  it('pulses at 1 Hz on the scene clock while a card waits, steady otherwise', () => {
    const { chip, root, scene } = build()
    chip.set(eventChipModel(mods(0), true))
    scene.events.emit('update', QUEST_PULSE_MS + 10)
    expect(root.alpha).toBe(QUEST_PULSE_ALPHA)
    scene.events.emit('update', 2 * QUEST_PULSE_MS + 10)
    expect(root.alpha).toBe(1)
    scene.events.emit('update', QUEST_PULSE_MS + 10)
    chip.set(eventChipModel(mods(1), false))
    expect(root.alpha).toBe(1)
    scene.events.emit('update', QUEST_PULSE_MS + 10)
    expect(root.alpha).toBe(1)
    // Game over: a waiting card never blinks.
    chip.set(eventChipModel(mods(1), true, true))
    scene.events.emit('update', QUEST_PULSE_MS + 10)
    expect(root.alpha).toBe(1)
  })

  it('setDepth moves the zone with the visuals; destroy drops the update listener', () => {
    const { chip, zone, root, scene } = build()
    chip.setDepth(42)
    expect(root.depth).toBe(42)
    expect(zone.depth).toBe(42)
    expect(scene.events.count('update')).toBe(1)
    chip.destroy()
    chip.destroy()
    expect(scene.events.count('update')).toBe(0)
    expect(zone.destroyed).toBe(true)
    expect(root.destroyed).toBe(true)
    // A late set() after destroy is ignored.
    expect(() => chip.set(eventChipModel(mods(1), true))).not.toThrow()
  })
})
