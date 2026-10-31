// Build 3 M12 (B3 §3.4; M12 contract §2, D-M12-1/2/19/20, critique 5, 18,
// 19): the EventCard on a stub scene — the modal stack and the keyboard
// (open / close / reopen / relayout), Enter = the first option and never a
// danger or greyed one (`Tap an option`), Esc swallowed on a decision or a
// job, Esc / Enter / any tap answering a news card (the scrim and the panel
// ignored while the card slides in — the option buttons too, review
// card-2), a greyed option's deny with the tooltip
// over its button, the faces, the button ids by data index, a decision whose
// `if` hid the rest staying a decision, world-atlas frames only, the scrim a
// Zone with its id, the openedTick, and a real deck card decided through the
// ViewSim. Phaser is stubbed with chainable no-op game objects (the card
// builds real kit Buttons).
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

const ec = await import('../../src/ui/EventCard.ts')
const et = await import('../../src/ui/effectText.ts')
const { CONTENT_PAD } = await import('../../src/ui/Button.ts')
const { computeLayout } = await import('../../src/ui/layout.ts')
const { keyClaimed, modalCount, popModal, pushModal, topModal } =
  await import('../../src/ui/Sheet.ts')
const { inAtlas } = await import('../../src/render/frames.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { dataFixture, makeSim } = await import('../sim/helpers.ts')

import type { EffectLine } from '../../src/sim/systems/effects.ts'
import type { EventOptionView, OpenCardView } from '../../src/sim/view-api.ts'

const data = dataFixture()

// ---- the stub scene -------------------------------------------------------------

function emitter() {
  const ls = new Map<
    string,
    { fn: (...a: unknown[]) => void; ctx: unknown; once: boolean }[]
  >()
  const add = (
    n: string,
    fn: (...a: unknown[]) => void,
    ctx: unknown,
    once: boolean,
  ) => {
    ls.set(n, [...(ls.get(n) ?? []), { fn, ctx, once }])
  }
  return {
    on: (n: string, fn: (...a: unknown[]) => void, ctx?: unknown) =>
      add(n, fn, ctx, false),
    once: (n: string, fn: (...a: unknown[]) => void, ctx?: unknown) =>
      add(n, fn, ctx, true),
    off: (n: string, fn: (...a: unknown[]) => void, ctx?: unknown) => {
      ls.set(
        n,
        (ls.get(n) ?? []).filter((l) => !(l.fn === fn && l.ctx === ctx)),
      )
    },
    emit: (n: string, ...args: unknown[]) => {
      const list = ls.get(n) ?? []
      ls.set(
        n,
        list.filter((l) => !l.once),
      )
      for (const l of list) l.fn.call(l.ctx, ...args)
    },
    count: (n: string) => (ls.get(n) ?? []).length,
  }
}

type Emitter = ReturnType<typeof emitter>
interface FakeButton {
  id: string
  onClick: (() => void) | null
  onDisabledTap: (() => void) | null
}

function fakeScene() {
  const sfx: unknown[] = []
  const taps: unknown[] = []
  const tips: { text: string; x: number; y: number }[] = []
  const frames: string[] = []
  const zones: (Emitter & Bag)[] = []
  const panels: (Emitter & Bag)[] = []
  const buttons: FakeButton[] = []
  const game = { events: emitter() }
  game.events.on('ui:sfx', (p) => sfx.push(p))
  game.events.on('ui:tap', (p) => taps.push(p))
  game.events.on('pm:tooltip', (p) => tips.push(p as (typeof tips)[number]))
  const scene = {
    scale: { width: 360, height: 604, zoom: 1 },
    add: {
      rectangle: () => chain({}),
      nineslice: (_x: number, _y: number, _k: string, frame: string) => {
        frames.push(frame)
        const o = chain({ ...emitter(), frameName: frame })
        if (frame === 'ui_panel') panels.push(o)
        return o
      },
      bitmapText: () => chain({}),
      image: (_x: number, _y: number, _k: string, frame: string) => {
        frames.push(frame)
        return chain({})
      },
      container: () => chain({}),
      zone: () => {
        const z = chain({ ...emitter() })
        zones.push(z)
        return z
      },
      existing: (o: unknown) => {
        const b = o as FakeButton
        if (typeof b.id === 'string' && b.id.startsWith('event:'))
          buttons.push(b)
        return o
      },
    },
    children: { list: [] as unknown[] },
    input: { keyboard: emitter() },
    events: emitter(),
    game,
    time: {
      now: 0,
      addEvent: () => ({ remove() {} }),
      delayedCall: () => ({ remove() {} }),
    },
    tweens: {
      add: () => ({ stop() {} }),
      addCounter: () => ({ stop() {} }),
    },
  }
  return { scene, sfx, taps, tips, frames, zones, panels, buttons }
}

const key = (k: string) => ({ key: k, repeat: false }) as KeyboardEvent
const tapAt = { getDistance: () => 0 }

// ---- views ------------------------------------------------------------------------

const ONE: EffectLine[] = [{ text: '−$150', tone: 'cost' }]

function opt(
  index: number,
  extra: Partial<EventOptionView> = {},
): EventOptionView {
  return {
    index,
    label: `Option ${index}`,
    lines: ONE,
    cost: 0,
    default: false,
    danger: false,
    affordable: true,
    reason: null,
    ...extra,
  }
}

function view(extra: Partial<OpenCardView> = {}): OpenCardView {
  return {
    eventId: 'ev_test',
    kind: 'decision',
    category: 'staff',
    word: 'STAFF',
    picture: 'ev_pic_staff',
    title: 'The scanner course',
    body: 'A vendor offers a weekend course.',
    day: 4,
    openedTick: 1234,
    parentChoice: null,
    chainTitle: null,
    questId: null,
    options: [opt(0), opt(1)],
    ...extra,
  }
}

function makeCard(W = 360, H = 604) {
  const f = fakeScene()
  const L = computeLayout(W, H, 0, 0, 1)
  const onOption = vi.fn()
  const card = new ec.EventCard(f.scene as never, L, data, { onOption })
  return { card, onOption, L, ...f }
}

const lastButton = (bs: FakeButton[], id: string): FakeButton => {
  const b = bs.filter((x) => x.id === id).at(-1)
  if (!b) throw new Error(`no button ${id}`)
  return b
}

describe('B3 §3.4 the EventCard on the modal stack (D-M12-1)', () => {
  it('open puts it on top and registers keydown; close pops it and the keys stop', () => {
    const { card, scene, onOption } = makeCard()
    const before = modalCount()
    card.open(view())
    expect(card.isOpen).toBe(true)
    expect(card.eventId).toBe('ev_test')
    expect(card.openedTick).toBe(1234)
    expect(topModal()).toBe(card)
    expect(modalCount()).toBe(before + 1)
    expect(scene.input.keyboard.count('keydown')).toBe(1)
    card.close()
    expect(card.isOpen).toBe(false)
    expect(card.model).toBeNull()
    expect(card.rect).toBeNull()
    expect(modalCount()).toBe(before)
    expect(scene.input.keyboard.count('keydown')).toBe(0)
    scene.input.keyboard.emit('keydown', key('Enter'))
    expect(onOption).not.toHaveBeenCalled()
  })

  it('opening the shown card again rebuilds in place: one modal entry, one key listener', () => {
    const { card, scene } = makeCard()
    const before = modalCount()
    card.open(view())
    card.open(view({ title: 'Changed' }))
    expect(modalCount()).toBe(before + 1)
    expect(scene.input.keyboard.count('keydown')).toBe(1)
    expect(card.model?.flow.find((f) => f.kind === 'title')?.text).toBe(
      'Changed',
    )
    // critique 18: a back-to-back job card (same id, a new openedTick) is a new card.
    card.open(view({ openedTick: 2000 }))
    expect(card.openedTick).toBe(2000)
    expect(modalCount()).toBe(before + 1)
    card.close()
  })

  it('the rect is eventCardRect of the laid-out height; relayout keeps the card open, on top, at the new rect', () => {
    const { card, L } = makeCard()
    card.open(view())
    const m = card.model!
    expect(card.rect).toEqual(et.eventCardRect(L, m.h))
    expect(card.rect!.x).toBe(30)
    const L2 = computeLayout(393, 659, 0, 0, 1)
    card.relayout(L2)
    expect(card.isOpen).toBe(true)
    expect(topModal()).toBe(card)
    expect(card.rect).toEqual(et.eventCardRect(L2, m.h))
    expect(card.rect!.x).toBe(47)
    card.close()
  })

  it('destroy closes it and drops the shutdown listener', () => {
    const { card, scene } = makeCard()
    expect(scene.events.count('shutdown')).toBe(1)
    card.open(view())
    card.destroy()
    expect(card.isOpen).toBe(false)
    expect(scene.events.count('shutdown')).toBe(0)
    card.open(view())
    expect(card.isOpen).toBe(false)
  })
})

describe('D-M12-2 the keys: Enter = the first option, never danger or greyed', () => {
  it('Enter on a decision answers its first option (by data index)', () => {
    const { card, scene, onOption } = makeCard()
    card.open(view({ options: [opt(1), opt(2)] }))
    scene.input.keyboard.emit('keydown', key('Enter'))
    expect(onOption).toHaveBeenCalledWith('ev_test', 1)
    expect(card.isOpen).toBe(true)
    card.close()
  })

  it.each([
    ['danger', { danger: true }],
    ['greyed', { affordable: false, cost: 150, reason: "Can't afford" }],
  ] as const)(
    'Enter whose first option is %s calls nothing: deny + `Tap an option`',
    (_n, first) => {
      const { card, scene, onOption, sfx, tips } = makeCard()
      card.open(view({ options: [opt(0, first), opt(1)] }))
      scene.input.keyboard.emit('keydown', key('Enter'))
      expect(onOption).not.toHaveBeenCalled()
      expect(sfx).toContainEqual({ name: 'deny' })
      expect(tips.at(-1)?.text).toBe(et.EVENT_ENTER_DENY)
      card.close()
    },
  )

  it('Esc on a decision or a job calls nothing but is claimed; a repeat is ignored', () => {
    for (const kind of ['decision', 'job'] as const) {
      const { card, scene, onOption } = makeCard()
      card.open(view({ kind }))
      const ev = key('Escape')
      scene.input.keyboard.emit('keydown', ev)
      expect(keyClaimed(ev)).toBe(true)
      expect(card.isOpen).toBe(true)
      expect(onOption).not.toHaveBeenCalled()
      scene.input.keyboard.emit('keydown', {
        key: 'Enter',
        repeat: true,
      } as KeyboardEvent)
      expect(onOption).not.toHaveBeenCalled()
      card.close()
    }
  })

  it('Esc and Enter on news answer the OK (index 0)', () => {
    for (const k of ['Escape', 'Enter']) {
      const { card, scene, onOption } = makeCard()
      card.open(view({ kind: 'news', options: [opt(0, { label: 'OK' })] }))
      scene.input.keyboard.emit('keydown', key(k))
      expect(onOption).toHaveBeenCalledWith('ev_test', 0)
      card.close()
    }
  })

  it('another modal on top owns the keys (a Dialog over the card)', () => {
    const { card, scene, onOption } = makeCard()
    card.open(view())
    const other = {}
    pushModal(other)
    scene.input.keyboard.emit('keydown', key('Enter'))
    expect(onOption).not.toHaveBeenCalled()
    popModal(other)
    scene.input.keyboard.emit('keydown', key('Enter'))
    expect(onOption).toHaveBeenCalledTimes(1)
    card.close()
  })
})

describe('B3 §3.4 taps: the options, the scrim, the panel (critique 19)', () => {
  it('an option button answers with its data index; the ids are event:opt<index>', () => {
    const { card, onOption, buttons, scene } = makeCard()
    card.open(view({ options: [opt(0), opt(2, { danger: true })] }))
    expect(buttons.map((b) => b.id)).toEqual(['event:opt0', 'event:opt2'])
    scene.time.now = et.EVENT_CARD_IN_MS
    lastButton(buttons, 'event:opt2').onClick?.()
    expect(onOption).toHaveBeenCalledWith('ev_test', 2)
    card.close()
  })

  it('review card-2: an option button (or a greyed one) is dead while the card slides in, and again when another card takes the slot — a double tap never decides the next card unread; tap() is not guarded', () => {
    const { card, onOption, buttons, scene, tips } = makeCard()
    scene.time.now = 2000
    card.open(
      view({
        options: [
          opt(0),
          opt(1, { danger: true }),
          opt(2, { affordable: false, cost: 150, reason: "Can't afford" }),
        ],
      }),
    )
    scene.time.now = 2000 + et.EVENT_CARD_IN_MS - 1
    lastButton(buttons, 'event:opt1').onClick?.()
    lastButton(buttons, 'event:opt2').onDisabledTap?.()
    expect(onOption).not.toHaveBeenCalled()
    expect(tips).toHaveLength(0)
    scene.time.now = 2000 + et.EVENT_CARD_IN_MS
    lastButton(buttons, 'event:opt0').onClick?.()
    expect(onOption).toHaveBeenCalledWith('ev_test', 0)
    // The HUD shows the next card in the same slot: a fresh read-in guard.
    card.open(view({ eventId: 'ev_next', openedTick: 1300 }))
    lastButton(buttons, 'event:opt1').onClick?.()
    expect(onOption).toHaveBeenCalledTimes(1)
    card.tap(1) // tests / e2e press an option directly
    expect(onOption).toHaveBeenLastCalledWith('ev_next', 1)
    scene.time.now += et.EVENT_CARD_IN_MS
    lastButton(buttons, 'event:opt0').onClick?.()
    expect(onOption).toHaveBeenLastCalledWith('ev_next', 0)
    card.close()
  })

  it('a greyed option denies (sfx + a tooltip at its button centre) and calls nothing', () => {
    const { card, onOption, sfx, tips, buttons, scene } = makeCard()
    card.open(
      view({
        options: [
          opt(0),
          opt(1, { affordable: false, cost: 150, reason: "Can't afford" }),
        ],
      }),
    )
    const r = card.rect!
    const o = card.model!.options[1]!
    card.tap(1)
    expect(onOption).not.toHaveBeenCalled()
    expect(sfx).toContainEqual({ name: 'deny' })
    expect(tips.at(-1)).toEqual({
      text: "Can't afford",
      x: r.x + 12 + 138,
      y: r.y + o.y,
    })
    scene.time.now = et.EVENT_CARD_IN_MS // the slide-in guard (card-2)
    lastButton(buttons, 'event:opt1').onDisabledTap?.()
    expect(tips).toHaveLength(2)
    expect(onOption).not.toHaveBeenCalled()
    card.close()
  })

  it('deny(text, index) from the HUD (a refused command): tooltip over that option; closed → sfx only', () => {
    const { card, sfx, tips } = makeCard()
    card.open(view())
    card.deny('Not possible right now', 0)
    const r = card.rect!
    expect(tips.at(-1)).toEqual({
      text: 'Not possible right now',
      x: r.x + 150,
      y: r.y + card.model!.options[0]!.y,
    })
    card.close()
    card.deny('x', 0)
    expect(tips).toHaveLength(1)
    expect(
      sfx.filter((s) => (s as { name: string }).name === 'deny'),
    ).toHaveLength(2)
  })

  it('a decision card ignores a tap on the scrim and on the panel', () => {
    const { card, onOption, zones, panels, scene } = makeCard()
    card.open(view())
    scene.time.now = 1000
    const scrim = zones[0]!
    scrim.emit('pointerdown')
    scrim.emit('pointerup', tapAt)
    const panel = panels.at(-1)!
    panel.emit('pointerdown')
    panel.emit('pointerup', tapAt)
    expect(onOption).not.toHaveBeenCalled()
    expect(card.isOpen).toBe(true)
    card.close()
  })

  it('a news card answers a tap anywhere — but not in the first 300 ms (the slide); the tap SFX id event:dismiss', () => {
    const { card, onOption, zones, panels, scene, taps } = makeCard()
    scene.time.now = 5000
    card.open(view({ kind: 'news', options: [opt(0, { label: 'OK' })] }))
    const scrim = zones[0]!
    scrim.emit('pointerdown')
    scrim.emit('pointerup', tapAt)
    expect(onOption).not.toHaveBeenCalled()
    scene.time.now = 5000 + et.EVENT_CARD_IN_MS - 1
    panels.at(-1)!.emit('pointerdown')
    panels.at(-1)!.emit('pointerup', tapAt)
    expect(onOption).not.toHaveBeenCalled()
    scene.time.now = 5000 + et.EVENT_CARD_IN_MS
    scrim.emit('pointerdown')
    scrim.emit('pointerup', tapAt)
    expect(onOption).toHaveBeenCalledWith('ev_test', 0)
    expect(taps).toContainEqual({ id: ec.EVENT_DISMISS_ID })
    panels.at(-1)!.emit('pointerdown')
    panels.at(-1)!.emit('pointerup', tapAt)
    expect(onOption).toHaveBeenCalledTimes(2)
    // A drag (or an unarmed up) is not a tap.
    scrim.emit('pointerup', tapAt)
    scrim.emit('pointerdown')
    scrim.emit('pointerup', { getDistance: () => 40 })
    expect(onOption).toHaveBeenCalledTimes(2)
    card.close()
  })

  it('critique 5: a decision whose `if` hid all but one option is not tap-anywhere', () => {
    const { card, onOption, zones, scene } = makeCard()
    card.open(view({ options: [opt(1, { danger: true })] }))
    expect(card.model!.mode).toBe('decision')
    scene.time.now = 99_999
    zones[0]!.emit('pointerdown')
    zones[0]!.emit('pointerup', tapAt)
    expect(onOption).not.toHaveBeenCalled()
    card.close()
  })

  it('the scrim is a Zone carrying its id (D-M12-20)', () => {
    const { card, zones } = makeCard()
    expect(zones).toHaveLength(1)
    expect(card.scrim).toBe(zones[0])
    expect(ec.EVENT_SCRIM_ID).toBe('event:scrim')
  })
})

describe('B3 §3.4 what the card draws', () => {
  it('faces: first primary, danger red, the rest secondary', () => {
    const { card } = makeCard()
    card.open(view({ options: [opt(0), opt(1, { danger: true }), opt(2)] }))
    expect(card.model!.options.map((o) => o.face)).toEqual([
      'primary',
      'red',
      'secondary',
    ])
    expect(card.model!.mode).toBe('three')
    card.close()
  })

  it('every frame it draws is a world frame (ev_pic_*, ic_event, ui_panel, ui_tag, the buttons)', () => {
    const { card, frames } = makeCard()
    card.open(view())
    card.close()
    card.open(view({ picture: 'no_such_frame' }))
    card.close()
    expect(frames).toContain('ev_pic_staff')
    expect(frames).toContain('ic_event')
    expect(frames).toContain('ui_panel')
    expect(frames).toContain('ui_tag')
    for (const f of [
      ...new Set(frames),
      'ui_btn',
      'ui_btn_primary',
      'ui_btn_red',
      'ui_btn_off',
      'ui_tooltip',
      ...Object.values(data.events.categories).map((c) => c.picture),
    ])
      expect(inAtlas(f, 'world'), f).toBe(true)
  })

  it('the label room matches the Button kit (EVENT_LABEL_PAD = CONTENT_PAD)', () => {
    expect(et.EVENT_LABEL_PAD).toBe(CONTENT_PAD)
  })

  it('a job card shows its objective (D-M12-6)', () => {
    const { card } = makeCard()
    card.open(
      view({
        kind: 'job',
        word: 'JOB BOARD',
        options: [opt(0, { label: 'Accept' }), opt(1, { label: 'Decline' })],
      }),
      { objective: 'Deliver 6 parcels sent from Registry Row' },
    )
    const m = card.model!
    expect(m.mode).toBe('job')
    expect(m.flow.some((f) => f.kind === 'objective')).toBe(true)
    expect(m.enter).toBe(0)
    card.close()
  })
})

describe('a real deck card through the ViewSim', () => {
  it('opens from vs.events().open; an option decides through vs.event.decide and the HUD-style close', () => {
    const def = data.events.deck.find(
      (d) => !d.router && d.drawable !== false && (d.options?.length ?? 0) >= 2,
    )!
    const sim = makeSim(1)
    sim.state.economy.balance = 99_999
    const vs = createViewSim(sim, { debug: true })
    expect(vs.debug!.offerEvent(def.id).ok).toBe(true)
    const v = vs.events().open!
    const f = fakeScene()
    const L = computeLayout(360, 604, 0, 0, 1)
    const card: InstanceType<typeof ec.EventCard> = new ec.EventCard(
      f.scene as never,
      L,
      data,
      {
        onOption: (id, i) => {
          const r = vs.event.decide(id, i)
          if (r.ok) card.close()
          else card.deny('Not possible right now', i)
        },
      },
    )
    card.open(v)
    expect(card.model!.options.length).toBe(v.options.length)
    expect(card.model!.masthead).toBe(
      data.events.categories[def.category]!.word,
    )
    const first = card.model!.options.find(
      (o) => o.enabled && o.face !== 'red',
    )!
    card.tap(first.index)
    expect(card.isOpen).toBe(false)
    expect(vs.events().open).toBeNull()
    expect(vs.events().history.at(-1)?.eventId).toBe(def.id)
  })
})
