// M7 QuestCard (spec-build2 §3.1, §3.4; design-m7 §6.3, §7 "quest-card";
// plan-build2 §8.4 task 4): the card rect (300×212, 8 px above the bottom
// bar: 360×604 → y 320, 393×659 → y 375, centred in the 430 column), the
// button row the e2e taps (Accept x + 6, Later x + 134 at y + 160), the
// model per mode (the Golden Release: gold, no Decline, the
// blocked line), every line fitting its row in m5x7 (flavour and objective in
// ≤ 2 lines of 276 px for every template, target and magic A/B pair), and the
// card itself on a stub scene against a live sim: the modal stack, Later /
// Esc / Enter, Accept left to the caller, deny, refresh, the
// Abandon confirm and the complete state. Phaser is stubbed with chainable
// no-op game objects (the card builds real kit Buttons).
// Build 3 M12 (B3 §3.4, §6 "one path for jobs"): a job offer is an EventCard,
// so the M11 interim job mode (Accept · Decline at the right edge, Esc only
// hiding the card) is gone: the offer mode is Accept · Later (only the
// Golden Release reaches it), no mode shows Decline, and Esc / outside are
// Later again; the abandon text names events.schedule.jobCooldownDays.
// M13 (plan-build3 §8.4 task 2, Q-B3-15): the dead job-offer leftovers are
// gone from the card — the Decline button (and its onDecline call) and the
// offer countdown (`offer ends in …` / `waiting for you`): no offer expires
// since build 3, so an offer's time row always reads `· the offer stays open`.
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

const qc = await import('../../src/ui/QuestCard.ts')
const { Dialog } = await import('../../src/ui/Dialog.ts')
const { wrapHeadline } = await import('../../src/ui/Newspaper.ts')
const { computeLayout } = await import('../../src/ui/layout.ts')
const { modalCount, topModal } = await import('../../src/ui/Sheet.ts')
const qt = await import('../../src/ui/questText.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { TICKS_PER_DAY } = await import('../../src/sim/types.ts')
const { dataFixture, noOffers, offerQuest, quietSim, startQuest } =
  await import('../sim/helpers.ts')

import type { QuestProgress } from '../../src/sim/types.ts'
import type { QuestView } from '../../src/sim/view-api.ts'

const data = dataFixture()
const DAY = TICKS_PER_DAY
const OFFER_TICK = 150

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
const INNER = qc.QUEST_CARD_INNER_W
/** Fits `maxLines` lines of the card's inner width without a cut. */
const fits = (s: string, maxLines: number): boolean => {
  const lines = wrapHeadline(s, INNER, maxLines, width)
  return (
    lines.length <= maxLines &&
    !lines.some((l) => l.endsWith('…') && !s.endsWith('…')) &&
    lines.every((l) => width(l) <= INNER) &&
    lines.join(' ') === s.trim().split(/\s+/).join(' ')
  )
}

// ---- views --------------------------------------------------------------------------

function offer(templateId: string): QuestView {
  const sim = noOffers(quietSim(1))
  sim.state.tick = OFFER_TICK
  offerQuest(sim, templateId)
  const v = createViewSim(sim).quests().offer
  if (!v) throw new Error(`no offer for ${templateId}`)
  return v
}

function active(
  templateId: string,
  progress: Partial<QuestProgress>,
  ticksLeft: number,
  extra: Partial<QuestView> = {},
): QuestView {
  const o = offer(templateId)
  return {
    ...o,
    status: 'active',
    acceptedTick: OFFER_TICK,
    deadlineTick: OFFER_TICK + ticksLeft,
    ticksLeft,
    progress: { ...o.progress, ...progress } as QuestProgress,
    ...extra,
  }
}

function at(q: QuestView, district: string): QuestView {
  const d = data.districts.find((x) => x.id === district)!
  const line = data.puns.quests[q.templateId] ?? ''
  return {
    ...q,
    target: district,
    targetName: d.flavour,
    flavour: line.replaceAll('{district}', d.flavour),
  }
}

const names = qt.buildingNamer(data)
const TEMPLATE_IDS = [
  ...data.quests.templates.map((t) => t.id),
  'golden_release',
]

// ---- geometry --------------------------------------------------------------------------

describe('design-m7 §6.3: the card rect, 8 px above the bottom bar', () => {
  it('360×604 → (30, 320, 300, 212); 393×659 → y 375; centred in the 430 column', () => {
    const L360 = computeLayout(360, 604, 0, 0, 1)
    expect(qc.questCardRect(L360)).toEqual({ x: 30, y: 320, w: 300, h: 212 })
    const L393 = computeLayout(393, 659, 0, 0, 1)
    const r393 = qc.questCardRect(L393)
    expect(r393.y).toBe(375)
    expect(r393.w).toBe(300)
    expect(Math.abs(r393.x - (393 - r393.x - r393.w))).toBeLessThanOrEqual(1)
    const L430 = computeLayout(430, 932, 47, 34, 1)
    const r430 = qc.questCardRect(L430)
    expect(r430).toMatchObject({ x: 65, w: 300, h: 212 })
    expect(r430.y + r430.h).toBe(L430.bottomBar.y - 8)
  })

  it('clears the HUD top (bar + ticker + toast lane) and stays on the canvas at 360 / 393 / 430', () => {
    for (const [W, H, st, sb] of [
      [360, 604, 0, 0],
      [393, 659, 0, 0],
      [393, 852, 47, 34],
      [430, 932, 47, 34],
    ] as const) {
      const L = computeLayout(W, H, st, sb, 1)
      const r = qc.questCardRect(L)
      expect(r.x).toBeGreaterThanOrEqual(6)
      expect(r.x + r.w).toBeLessThanOrEqual(W - 6)
      expect(r.y).toBeGreaterThan(L.toast.y + L.toast.h)
      expect(r.y + r.h).toBeLessThanOrEqual(L.bottomBar.y - 8)
    }
    // A canvas narrower than 312 px: W − 12 wide.
    expect(qc.questCardRect(computeLayout(300, 604, 0, 0, 1)).w).toBe(288)
  })

  it('the button row: Accept x + 6 (120), Later x + 134 at y + 160 (the e2e taps)', () => {
    expect(qc.QUEST_CARD_ROWS.buttons).toBe(160)
    expect(qc.QUEST_CARD_BTN_H).toBe(44)
    expect(
      qc.QUEST_CARD_ROWS.buttons + qc.QUEST_CARD_BTN_H,
    ).toBeLessThanOrEqual(qc.QUEST_CARD_H)
    expect(qc.questCardButtonRects(300, ['accept', 'later'])).toEqual([
      { name: 'accept', x: 6, w: 120 },
      { name: 'later', x: 134, w: 72 },
    ])
    expect(qc.questCardButtonRects(300, ['abandon', 'close'])).toEqual([
      { name: 'abandon', x: 6, w: 96 },
      { name: 'close', x: 166, w: 120 },
    ])
    expect(qc.questCardButtonRects(300, ['ok'])).toEqual([
      { name: 'ok', x: 90, w: 120 },
    ])
  })

  it('buttons stay inside the card and never overlap, at 300 and 288', () => {
    for (const w of [300, 288]) {
      for (const set of [
        ['accept', 'later'],
        ['abandon', 'close'],
        ['ok'],
      ] as const) {
        const r = qc.questCardButtonRects(w, set)
        for (const b of r) {
          expect(b.x).toBeGreaterThanOrEqual(6)
          expect(b.x + b.w).toBeLessThanOrEqual(w - 6)
          expect(b.w).toBeGreaterThanOrEqual(44)
        }
        for (let i = 1; i < r.length; i++)
          expect(r[i]!.x).toBeGreaterThanOrEqual(r[i - 1]!.x + r[i - 1]!.w + 8)
      }
    }
  })
})

describe('M5 atlas rule: the card binds world frames only', () => {
  it('every frame the card and the quest papers draw is packed into world', async () => {
    const { inAtlas } = await import('../../src/render/frames.ts')
    const { BAR_FILL } = await import('../../src/ui/Panel.ts')
    for (const f of [
      'ic_quest',
      'ic_star',
      'ui_panel',
      'ui_card_gold',
      'ui_bar_track',
      BAR_FILL.gold,
      'ui_btn',
      'ui_btn_primary',
      'ui_btn_red',
      'ui_tooltip',
    ])
      expect(inAtlas(f, 'world'), f).toBe(true)
  })
})

// ---- model ------------------------------------------------------------------------------

describe('design-m7 §6.3: the model per mode', () => {
  it('M12: the offer mode is Accept / Later for any quest (a job offer is an EventCard since M12; its model still reads JOB BOARD); M13: the button set has no Decline at all and an offer never counts down', () => {
    const q = at(offer('rush_district'), 'downtown')
    const m = qc.questCardModel(data, q, 'offer', OFFER_TICK + 150, names, null)
    expect(m).toEqual({
      title: 'Rush hour',
      masthead: 'JOB BOARD',
      gold: false,
      flavour: 'Registry Row is swamped — get their parcels moving',
      objective: 'Deliver 6 parcels sent from Registry Row',
      reward: 'Reward: $120',
      time: 'Time: 3 days · the offer stays open',
      bar: null,
      buttons: ['accept', 'later'],
      blocked: null,
      waiting: false,
    })
    expect(qc.questCardButtons('offer')).toEqual(['accept', 'later'])
    expect(qc.questCardButtons('active')).toEqual(['abandon', 'close'])
    expect(qc.questCardButtons('complete')).toEqual(['ok'])
    expect(Object.keys(qc.QUEST_BUTTON_LABEL)).not.toContain('decline')
  })

  it('the Golden Release offer: gold, its own masthead, Accept / Later only (no Decline), no expiry', () => {
    const q = offer('golden_release')
    const m = qc.questCardModel(data, q, 'offer', OFFER_TICK, names, null)
    expect(m.gold).toBe(true)
    expect(m.masthead).toBe('THE GOLDEN RELEASE')
    expect(m.buttons).toEqual(['accept', 'later'])
    expect(m.buttons).not.toContain('decline')
    expect(m.time).toBe('Time: 5 days · the offer stays open')
    expect(m.reward).toBe('Reward: Victory')
  })

  it('the Golden Release waiting on an active quest: `Finish "Rush hour" first`', () => {
    const q = offer('golden_release')
    const m = qc.questCardModel(
      data,
      q,
      'offer',
      OFFER_TICK,
      names,
      'Rush hour',
    )
    expect(m.blocked).toBe('Finish "Rush hour" first')
    // The line is for offers only.
    const a = active('golden_release', { delivered: 3 }, 2000)
    expect(
      qc.questCardModel(data, a, 'active', OFFER_TICK, names, 'Rush hour')
        .blocked,
    ).toBeNull()
  })

  it('the active card names an offer waiting on it in the flavour row, in gold (offers and complete cards keep their flavour)', () => {
    const a = active('rush_district', { count: 2 }, 900)
    const plain = qc.questCardModel(data, a, 'active', OFFER_TICK, names, null)
    expect(plain.waiting).toBe(false)
    const m = qc.questCardModel(
      data,
      a,
      'active',
      OFFER_TICK,
      names,
      null,
      'The Golden Release',
    )
    expect(m.waiting).toBe(true)
    expect(m.flavour).toBe(
      'The Golden Release is waiting — finish or abandon this job to take it.',
    )
    expect(m.buttons).toEqual(['abandon', 'close']) // Abandon stays one tap away
    for (const mode of ['offer', 'complete'] as const) {
      const o = qc.questCardModel(data, a, mode, OFFER_TICK, names, null, 'X')
      expect(o).toMatchObject({ waiting: false, flavour: plain.flavour })
    }
  })

  it('active: Abandon / Close, the gold progress bar and the time left', () => {
    const q = active('rush_district', { count: 4 }, 900, {
      goal: 10,
      progress01: 0.4,
    })
    const m = qc.questCardModel(data, q, 'active', OFFER_TICK, names, null)
    expect(m.buttons).toEqual(['abandon', 'close'])
    expect(m.bar).toBeCloseTo(0.4)
    expect(m.time).toBe('Time left: 1d 12h')
    expect(m.gold).toBe(false)
    expect(m.masthead).toBe('JOB BOARD')
    // Time left follows the tick it is drawn at.
    expect(
      qc.questCardModel(data, q, 'active', OFFER_TICK + 450, names, null).time,
    ).toBe('Time left: 18h')
  })

  it('the magic parcel: Time 2:00 as an offer, its clock and a draining bar while active', () => {
    const o = offer('magic_parcel')
    expect(
      qc.questCardModel(data, o, 'offer', OFFER_TICK, names, null).time,
    ).toBe('Time: 2:00 · the offer stays open')
    const a = active('magic_parcel', {}, 1200, {
      route: { origin: 'dt_registry_tower', dest: 'dt_semver_bank' },
    })
    const m = qc.questCardModel(data, a, 'active', OFFER_TICK + 20, names, null)
    expect(m.time).toBe('Time left: 1:58')
    expect(m.bar).toBeCloseTo(1180 / 1200)
    expect(m.objective).toBe(
      'Deliver the golden parcel: Registry Tower → Semver Savings Bank in 2:00',
    )
  })

  it('complete: QUEST COMPLETE in the gold frame, a full bar, OK', () => {
    const q = active('rush_district', { count: 6 }, 300)
    const m = qc.questCardModel(data, q, 'complete', 3 * DAY + 20, names, null)
    expect(m).toMatchObject({
      masthead: 'QUEST COMPLETE',
      gold: true,
      bar: 1,
      buttons: ['ok'],
      time: 'Completed on Day 4',
    })
  })

  it('gold frame rules: the Golden Release in every mode, every complete card, never a regular offer or active quest', () => {
    for (const id of TEMPLATE_IDS) {
      const o = offer(id)
      const ult = id === 'golden_release'
      expect(qc.questCardModel(data, o, 'offer', 0, names, null).gold).toBe(ult)
      expect(
        qc.questCardModel(data, active(id, {}, 600), 'active', 0, names, null)
          .gold,
      ).toBe(ult)
      expect(qc.questCardModel(data, o, 'complete', 0, names, null).gold).toBe(
        true,
      )
    }
  })

  it('the Abandon confirm: no penalty, and when another job can come (events.schedule.jobCooldownDays) or the Golden Release comes back', () => {
    expect(data.events.schedule.jobCooldownDays).toBe(1)
    expect(
      qc.abandonDialogText(data, { name: 'Rush hour', ultimate: false }),
    ).toEqual({
      title: 'Abandon Rush hour?',
      text: 'No penalty — you can take another job in 1 day.',
    })
    expect(
      qc.abandonDialogText(data, {
        name: 'The Golden Release',
        ultimate: true,
      }),
    ).toEqual({
      title: 'Abandon The Golden Release?',
      text: 'No penalty — it comes back in 1 day.',
    })
  })
})

describe('design-m7 §6.3: every line fits its row in m5x7 (inner width 276)', () => {
  const targets = data.districts.filter((d) => d.kind === 'district')

  it('flavour and objective in at most 2 lines for every template and every district target', () => {
    const bad: string[] = []
    for (const id of TEMPLATE_IDS) {
      const base = offer(id)
      const views =
        base.target !== null ? targets.map((d) => at(base, d.id)) : [base]
      for (const q of views) {
        for (const mode of ['offer', 'active', 'complete'] as const) {
          const m = qc.questCardModel(data, q, mode, OFFER_TICK, names, null)
          if (!fits(m.flavour, 2)) bad.push(`${id} flavour: ${m.flavour}`)
          if (!fits(m.objective, 2)) bad.push(`${id} objective: ${m.objective}`)
          // The card drops the district when the full reward overflows.
          if (!fits(m.reward, 1) && !fits(qt.rewardText(data, q, false), 1))
            bad.push(`${id} reward: ${m.reward}`)
          if (!fits(m.time, 1)) bad.push(`${id} time: ${m.time}`)
          if (width(m.title) > INNER) bad.push(`${id} title: ${m.title}`)
          const mast = width(m.masthead) + 20 + width('Day 999')
          if (mast > INNER) bad.push(`${id} masthead: ${m.masthead}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it("the magic parcel's A → B sentence in at most 2 lines for every pair of servable buildings", () => {
    const servable = new Set(
      data.districts
        .filter((d) => d.kind === 'district' && !d.hardRule)
        .map((d) => d.id),
    )
    const bs = data.buildings.filter((b) => servable.has(b.district))
    const base = active('magic_parcel', {}, 1200)
    const bad: string[] = []
    let pairs = 0
    for (const a of bs)
      for (const b of bs) {
        if (a.district === b.district) continue
        pairs++
        const q = { ...base, route: { origin: a.id, dest: b.id } }
        const s = qt.objectiveText(data, q, names)
        if (!fits(s, 2)) bad.push(s)
      }
    expect(pairs).toBeGreaterThan(100)
    expect(bad).toEqual([])
  })

  it('the blocked line fits one line for the longest template name; the abandon text two Dialog lines', () => {
    const longest = data.quests.templates
      .map((t) => t.name)
      .reduce((a, b) => (width(b) > width(a) ? b : a))
    const q = offer('golden_release')
    const m = qc.questCardModel(data, q, 'offer', 0, names, longest)
    expect(width(m.blocked!)).toBeLessThanOrEqual(INNER)
    // The waiting line (the Golden Release's name) in the 2 flavour lines.
    const w = qt.waitingText(data.puns.ultimateQuestName)
    expect(wrapHeadline(w, INNER, 2, width).join(' ')).toBe(w)
    for (const t of data.quests.templates) {
      const d = qc.abandonDialogText(data, { name: t.name, ultimate: false })
      expect(wrapHeadline(d.text, 256, 2, width).join(' ')).toBe(d.text)
      expect(width(d.title)).toBeLessThanOrEqual(256)
    }
  })
})

// ---- the card on a stub scene -------------------------------------------------------------

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

const obj = (): object => chain({})

function fakeScene() {
  const sfx: unknown[] = []
  const tips: { text: string; x: number; y: number }[] = []
  const game = { events: emitter() }
  game.events.on('ui:sfx', (p) => sfx.push(p))
  game.events.on('pm:tooltip', (p) => tips.push(p as (typeof tips)[number]))
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
      remove: () => {},
    },
    children: { list: [] as unknown[] },
    input: { keyboard: emitter() },
    events: emitter(),
    game,
    time: {
      addEvent: () => ({ remove() {} }),
      delayedCall: () => ({ remove() {} }),
    },
  }
  return { scene, sfx, tips }
}

const key = (k: string) => ({ key: k, repeat: false }) as KeyboardEvent

function makeCard(
  opts: Partial<ConstructorParameters<typeof qc.QuestCard>[3]> = {},
) {
  const { scene, sfx, tips } = fakeScene()
  const L = computeLayout(360, 604, 0, 0, 1)
  const cb = {
    onAccept: vi.fn(),
    onLater: vi.fn(),
    onAbandon: vi.fn(),
    onClose: vi.fn(),
  }
  const card = new qc.QuestCard(scene as never, L, data, { ...cb, ...opts })
  return { card, cb, scene, sfx, tips, L }
}

/** Every callback but `name` untouched. */
function onlyCalled(
  cb: Record<string, ReturnType<typeof vi.fn>>,
  name: string,
  times = 1,
): void {
  for (const [k, f] of Object.entries(cb))
    expect(f, k).toHaveBeenCalledTimes(k === name ? times : 0)
}

describe('design-m7 §6.3: the card on the modal stack (no sim hold)', () => {
  it('opens an offer on top of the modal stack: Accept / Later (M12: no interim job mode); a tap outside is Later (onLater only)', () => {
    const { card, cb } = makeCard()
    const q = offer('golden_release')
    const before = modalCount()
    card.open(q, 'offer', OFFER_TICK, 4)
    expect(card.isOpen).toBe(true)
    expect(card.questId).toBe(q.id)
    expect(card.mode).toBe('offer')
    expect(card.model?.buttons).toEqual(['accept', 'later'])
    expect(modalCount()).toBe(before + 1)
    expect(topModal()).toBe(card)
    ;(card as unknown as { outside(): void }).outside()
    expect(card.isOpen).toBe(false)
    expect(modalCount()).toBe(before)
    onlyCalled(cb, 'onLater')
  })

  it('the Golden Release keeps Later: it closes the card and calls onLater only', () => {
    const { card, cb } = makeCard()
    card.open(offer('golden_release'), 'offer', OFFER_TICK, 4)
    expect(card.model?.buttons).toEqual(['accept', 'later'])
    card.tap('later')
    expect(card.isOpen).toBe(false)
    onlyCalled(cb, 'onLater')
  })

  it('Esc is Later on an offer (onLater); Enter is Accept and leaves the card open for the caller', () => {
    const { card, cb, scene } = makeCard()
    const q = offer('golden_release')
    card.open(q, 'offer', OFFER_TICK, 4)
    scene.input.keyboard.emit('keydown', key('Enter'))
    expect(cb.onAccept).toHaveBeenCalledWith(q.id)
    expect(card.isOpen).toBe(true)
    scene.input.keyboard.emit('keydown', key('Escape'))
    expect(card.isOpen).toBe(false)
    expect(cb.onLater).toHaveBeenCalledTimes(1)
    // Closed: the keys no longer reach it.
    scene.input.keyboard.emit('keydown', key('Enter'))
    expect(cb.onAccept).toHaveBeenCalledTimes(1)
  })

  it('Accept through the sim: the caller closes on success, or denies a refusal (shake, deny SFX, tooltip over Accept)', () => {
    const sim = noOffers(quietSim(1))
    let vs = createViewSim(sim)
    offerQuest(sim, 'rush_district')
    const { card, sfx, tips } = makeCard({
      onAccept: (id: string) => {
        const res = vs.quest.accept(id)
        if (res.ok) card.close()
        else
          card.deny(
            res.reason === 'quest-active'
              ? 'Finish the current job first'
              : 'Not possible right now',
          )
      },
      blockedBy: (q: QuestView) => qt.questBlockedBy(vs.quests(), q),
    })
    card.open(vs.quests().offer!, 'offer', sim.state.tick, 1)
    card.tap('accept')
    expect(card.isOpen).toBe(false)
    expect(vs.quests().active?.templateId).toBe('rush_district')
    // The Golden Release (offered at Lv 5 by the scheduler; put in the offer
    // slot by hand here) waits on Rush hour: the blocked line, then a refusal.
    const other = noOffers(quietSim(1))
    const ult = offerQuest(other, 'golden_release')
    sim.state.quests.offer = { ...ult, id: `q${sim.state.nextId.quest++}` }
    vs = createViewSim(sim)
    const u = vs.quests().offer!
    card.open(u, 'offer', sim.state.tick, 1)
    expect(card.model?.blocked).toBe('Finish "Rush hour" first')
    card.tap('accept')
    expect(card.isOpen).toBe(true)
    expect(sfx).toContainEqual({ name: 'deny' })
    const r = qc.questCardRect(computeLayout(360, 604, 0, 0, 1))
    expect(tips.at(-1)).toEqual({
      text: 'Finish the current job first',
      x: r.x + 6 + 60,
      y: r.y + 160,
    })
    card.close()
  })

  it('refresh: a quest that left the slot closes the card; an offer accepted elsewhere turns it active', () => {
    const { card, cb } = makeCard()
    const q = offer('rush_district')
    card.open(q, 'offer', OFFER_TICK, 4)
    expect(card.model?.time).toBe('Time: 3 days · the offer stays open')
    card.refresh(
      {
        ...q,
        status: 'active',
        deadlineTick: OFFER_TICK + 3 * DAY,
        ticksLeft: 3 * DAY,
      },
      OFFER_TICK,
    )
    expect(card.mode).toBe('active')
    expect(card.model?.buttons).toEqual(['abandon', 'close'])
    card.refresh(null, OFFER_TICK + 10)
    expect(card.isOpen).toBe(false)
    card.open(q, 'offer', OFFER_TICK, 4)
    card.refresh({ ...q, id: 'q99' }, OFFER_TICK)
    expect(card.isOpen).toBe(false)
    // Programmatic closes call nothing.
    for (const f of Object.values(cb)) expect(f).not.toHaveBeenCalled()
  })

  it('Abandon asks first (a Dialog on top): Esc keeps the quest, the confirm abandons it', () => {
    const { card, cb, scene } = makeCard()
    const q = active('rush_district', { count: 2 }, 900)
    const before = modalCount()
    card.open(q, 'active', OFFER_TICK, 4)
    card.tap('abandon')
    expect(modalCount()).toBe(before + 2)
    expect(topModal()).toBeInstanceOf(Dialog)
    scene.input.keyboard.emit('keydown', key('Escape'))
    expect(card.isOpen).toBe(true)
    expect(topModal()).toBe(card)
    expect(cb.onAbandon).not.toHaveBeenCalled()
    card.tap('abandon')
    scene.input.keyboard.emit('keydown', key('Enter'))
    expect(card.isOpen).toBe(false)
    expect(modalCount()).toBe(before)
    onlyCalled(cb, 'onAbandon')
    expect(cb.onAbandon).toHaveBeenCalledWith(q.id)
  })

  it('Close / Esc on an active quest call onClose', () => {
    const { card, cb, scene } = makeCard()
    const q = active('rush_district', {}, 900)
    card.open(q, 'active', OFFER_TICK, 4)
    card.tap('close')
    expect(card.isOpen).toBe(false)
    card.open(q, 'active', OFFER_TICK, 4)
    scene.input.keyboard.emit('keydown', key('Escape'))
    expect(card.isOpen).toBe(false)
    onlyCalled(cb, 'onClose', 2)
  })

  it('complete: gold, OK, the reward it was paid; a polled refresh never closes it', () => {
    const { card, cb, scene } = makeCard()
    const q = active('rush_district', { count: 6 }, 100)
    card.open(q, 'active', OFFER_TICK, 4)
    card.showComplete(q, { ...q.reward, cash: 200 })
    expect(card.mode).toBe('complete')
    expect(card.model).toMatchObject({
      gold: true,
      masthead: 'QUEST COMPLETE',
      buttons: ['ok'],
      reward: 'Reward: $200',
    })
    card.refresh(null, OFFER_TICK + 50)
    expect(card.isOpen).toBe(true)
    scene.input.keyboard.emit('keydown', key('Enter'))
    expect(card.isOpen).toBe(false)
    onlyCalled(cb, 'onClose')
  })

  it('complete: Esc and a tap outside are OK (the scrim never swallows HUD taps)', () => {
    const { card, cb, scene } = makeCard()
    const q = active('rush_district', { count: 6 }, 100)
    card.open(q, 'active', OFFER_TICK, 4)
    card.showComplete(q, q.reward)
    scene.input.keyboard.emit('keydown', key('Escape'))
    expect(card.isOpen).toBe(false)
    card.open(q, 'active', OFFER_TICK, 4)
    card.showComplete(q, q.reward)
    expect(card.mode).toBe('complete')
    ;(card as unknown as { outside(): void }).outside()
    expect(card.isOpen).toBe(false)
    onlyCalled(cb, 'onClose', 2)
  })

  it('completeOn: only the quest on the card turns complete', () => {
    const { card } = makeCard()
    const q = active('rush_district', { count: 6 }, 100)
    card.open(q, 'active', OFFER_TICK, 4)
    expect(card.completeOn('q999', q.reward)).toBe(false)
    expect(card.mode).toBe('active')
    expect(card.completeOn(q.id, q.reward)).toBe(true)
    expect(card.mode).toBe('complete')
    card.close()
    expect(card.completeOn(q.id, q.reward)).toBe(false)
    expect(card.isOpen).toBe(false)
  })

  it('a live quest from the sim: the active card reads the counters through the ViewSim', () => {
    const sim = noOffers(quietSim(1))
    const vs = createViewSim(sim)
    startQuest(sim, 'big_haul')
    const { card } = makeCard()
    const a = vs.quests().active!
    card.open(a, 'active', sim.state.tick, vs.day + 1)
    expect(card.model).toMatchObject({
      title: 'Big haul',
      objective: 'Deliver 3 XL parcels',
      reward: 'Reward: $300',
      time: 'Time left: 4d 0h',
      bar: 0,
    })
    card.close()
  })

  it('relayout moves the card with the bottom bar', () => {
    const { card } = makeCard()
    card.open(offer('rush_district'), 'offer', OFFER_TICK, 4)
    card.relayout(computeLayout(393, 659, 0, 0, 1))
    expect(card.isOpen).toBe(true)
    card.close()
    card.destroy()
    card.destroy()
    expect(card.isOpen).toBe(false)
  })
})
