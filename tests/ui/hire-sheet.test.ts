// HireSheet (spec-build2 §2.7, §2.5; design-m6 §6.1; plan-build2 §8.3 task 7):
// the three-card geometry at 360 / 393 / 430, the pip model, the card lines
// (inspector / sorter / driver numbers, ★ `free` + `leaves in 2d`, affinity),
// every card line fitting the narrowest card in m5x7, and the sheet against
// a live sim through a stub scene: the Garage buy flow hires the picked
// driver (or `Hire later` parks the vehicle `No driver`), a Replace through
// the sheet, `Post an ad`, a stale card refused with `deny` (no-applicant), the
// buttons following the balance, Esc / a vanished target cancelling, and a
// sleeping scene closing it silently. Phaser is stubbed with chainable no-op
// game objects (the sheet builds real kit Buttons, which extend Container).
// Build 3 M12 (B3 §3.6): in the buy flow the vehicle's price is
// ViewSim.priceOf — a vehiclePrice card's sale price is what the cards and
// `Hire later` need and what the buy charges.
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

const hs = await import('../../src/ui/HireSheet.ts')
const { modalCount, topModal } = await import('../../src/ui/Sheet.ts')
const { CONTENT_PAD } = await import('../../src/ui/Button.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { addStarApplicant, salaryOf } =
  await import('../../src/sim/systems/people.ts')
const { applyModifier } = await import('../../src/sim/systems/modifierOps.ts')
const { dataFixture, fund, quietSim, standardApplicant, buy } =
  await import('../sim/helpers.ts')

import type { ApplicantView } from '../../src/sim/view-api.ts'
import type { Pips, Role, VehicleType } from '../../src/sim/types.ts'

const data = dataFixture()

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

// ---- pure model -------------------------------------------------------------------

describe('HireSheet geometry (design-m6 §6.1)', () => {
  it('three cards side by side at 360 / 393 / 430: 110 / 121 / 134 px, 6-px gaps, centred inside W', () => {
    const want: Record<number, number> = { 360: 110, 393: 121, 430: 134 }
    for (const W of [360, 393, 430]) {
      const r = hs.hireCardRects(W)
      expect(r).toHaveLength(3)
      expect(r.every((c) => c.w === want[W])).toBe(true)
      for (let i = 1; i < 3; i++)
        expect(r[i]!.x - (r[i - 1]!.x + r[i - 1]!.w)).toBeGreaterThanOrEqual(6)
      expect(r[0]!.x).toBeGreaterThanOrEqual(8)
      expect(r[2]!.x + r[2]!.w).toBeLessThanOrEqual(W - 8)
      // centred: equal side air (±1 px)
      expect(Math.abs(r[0]!.x - (W - r[2]!.x - r[2]!.w))).toBeLessThanOrEqual(1)
    }
    // A very wide canvas caps the cards at 140.
    expect(hs.hireCardRects(1200)[0]!.w).toBe(140)
  })

  it('the panel is 276 px (32 + 180 + 8 + 44 + 12), bottom on H − safeBottom, and clears the HUD top band at 360×604', () => {
    expect(hs.HIRE_SHEET_H).toBe(276)
    // Warehouse: above the 64-px HUD bottom band; Garage: above the safe area.
    for (const [W, H, sb] of [
      [360, 604, 64],
      [393, 659, 64 + 34],
      [430, 932, 64 + 34],
      [360, 604, 0],
    ] as const) {
      const r = hs.hireSheetRect(W, H, sb)
      expect(r.y + r.h).toBe(H - sb)
      expect(r.y).toBeGreaterThanOrEqual(64) // under the HUD top bar + ticker
      expect(r.w).toBe(W)
    }
    expect(hs.hireSheetRect(360, 200, 0).y).toBe(0)
  })

  it('the bottom row: `Post an ad $30` across the cards, or halves with `Hire later` (buy flow), labels with Button padding', () => {
    for (const W of [360, 393, 430]) {
      const cards = hs.hireCardRects(W)
      const x0 = cards[0]!.x
      const right = cards[2]!.x + cards[2]!.w
      const one = hs.hireRowRects(W, false)
      expect(one.ad).toEqual({ x: x0, w: right - x0 })
      expect(one.later).toBeNull()
      const two = hs.hireRowRects(W, true)
      expect(two.ad.x).toBe(x0)
      expect(two.later!.x + two.later!.w).toBe(right)
      expect(two.later!.x - (two.ad.x + two.ad.w)).toBeGreaterThanOrEqual(6)
      for (const [label, w] of [
        [hs.adLabel(data.employees.applicants.adPrice), two.ad.w],
        ['Hire later', two.later!.w],
      ] as const)
        expect(width(label), label).toBeLessThanOrEqual(w - 2 * CONTENT_PAD)
    }
    expect(hs.adLabel(30)).toBe('Post an ad $30')
  })

  it('pipModel: n lit of max (●●●○○), clamped', () => {
    expect(hs.pipModel(3, 5)).toEqual([true, true, true, false, false])
    expect(hs.pipModel(0, 2)).toEqual([false, false])
    expect(hs.pipModel(2, 2)).toEqual([true, true])
    expect(hs.pipModel(7, 5)).toEqual([true, true, true, true, true])
    expect(hs.pipModel(-1, 5).some(Boolean)).toBe(false)
    expect(hs.pipsWidth(5)).toBe(36)
    expect(hs.pipsWidth(2)).toBe(15)
  })
})

/** An ApplicantView as the ViewSim builds it, from a live pool. */
function view(
  role: Role,
  pips: Pips,
  type: VehicleType = 'bike',
  affinity: 'none' | VehicleType = 'none',
): ApplicantView {
  const sim = quietSim(1)
  const a = standardApplicant(sim, role, pips, affinity)
  const vs = createViewSim(sim)
  return vs.applicants(role, type).find((x) => x.id === a.id)!
}

describe('HireSheet pool-refresh countdown (M6 review)', () => {
  it('counts down to the next day boundary that refreshes the pools: `New faces in 0:23`', () => {
    expect(hs.ticksToPoolRefresh(0, 1)).toBe(600)
    expect(hs.ticksToPoolRefresh(370, 1)).toBe(230)
    expect(hs.ticksToPoolRefresh(599, 1)).toBe(1)
    expect(hs.ticksToPoolRefresh(600, 1)).toBe(600)
    // every 2 days: the next even day
    expect(hs.ticksToPoolRefresh(100, 2)).toBe(1100)
    expect(hs.ticksToPoolRefresh(700, 2)).toBe(500)
    expect(hs.poolRefreshNote(230)).toBe('New faces in 0:23')
    expect(hs.poolRefreshNote(600)).toBe('New faces in 1:00')
  })

  it('fits beside the longest note-less titles at 360 (title + 8 + note ≤ the card span)', () => {
    const r = hs.hireCardRects(360)
    const span = r[2]!.x + r[2]!.w - r[0]!.x
    const note = width(hs.poolRefreshNote(600))
    for (const title of [
      'Hire an inspector',
      'Hire a sorter',
      'Replace Audrey 2 · Truck 3',
      'Driver for Truck 3',
    ])
      expect(width(title) + 8 + note, title).toBeLessThanOrEqual(span)
  })
})

describe('HireSheet cards (spec-build2 §2.1-§2.2, design-m6 §6.1)', () => {
  it('an eye 3 / pace 3 / charisma 0 inspector: `catch 85% · 4.0s`, `false-flag 15%`, `$20/day · fee $20`', () => {
    const m = hs.cardModel(
      view('inspector', { eye: 3, pace: 3, charisma: 0 }),
      'inspector',
    )
    expect(m).toMatchObject({
      role: 'inspector',
      roleLine: 'Inspector',
      numbers: 'catch 85% · 4.0s',
      extra: 'false-flag 15%',
      affinity: null,
      money: '$20/day · fee $20',
      fee: 20,
      star: false,
    })
    expect(m.face).toMatch(/^face_\d\d$/)
    expect(m.pips.map((r) => [r.label, r.on.filter(Boolean).length])).toEqual([
      ['eye', 3],
      ['pace', 3],
      ['charisma', 0],
    ])
    expect(m.pips.map((r) => r.on.length)).toEqual([5, 5, 2])
  })

  it('a sorter: `85% · 1 per 6s`, judgement / pace rows, `$28/day · fee $28`', () => {
    const m = hs.cardModel(view('sorter', { judgement: 3, pace: 3 }), 'sorter')
    expect(m.numbers).toBe('85% · 1 per 6s')
    expect(m.pips.map((r) => r.label)).toEqual(['judgement', 'pace'])
    expect(m.money).toBe('$28/day · fee $28')
    expect(m.extra).toBeNull()
  })

  it('a driver priced for the class it would drive; affinity counted (speed 4 + van in a van = ×1.15) and shown as `likes`', () => {
    const pips = { speed: 4, energy: 3, charisma: 1 }
    const van = hs.cardModel(view('driver', pips, 'van', 'van'), 'driver')
    expect(van.numbers).toBe('×1.15 · stop ×1')
    expect(van.affinity).toBe('van')
    const s = salaryOf(data, 'driver', pips, 'van')
    expect(van.money).toBe(`$${s}/day · fee $${s}`)
    const bike = hs.cardModel(view('driver', pips, 'bike', 'van'), 'driver')
    expect(bike.numbers).toBe('×1.08 · stop ×1')
    expect(bike.salaryPerDay).toBe(salaryOf(data, 'driver', pips, 'bike'))
    const slow = hs.cardModel(
      view('driver', { speed: 1, energy: 1, charisma: 0 }),
      'driver',
    )
    expect(slow.numbers).toBe('×0.85 · stop ×1.3')
    expect(slow.affinity).toBeNull()
  })

  it('a ★ applicant: free, gold `leaves in 2d`, then `leaves today`', () => {
    const sim = quietSim(1)
    addStarApplicant(sim, {
      role: 'inspector',
      name: 'Grace',
      pips: { eye: 5, pace: 4, charisma: 2 },
    })
    const vs = createViewSim(sim)
    const a = vs.applicants('inspector')[0]!
    expect(a.star).toBe(true)
    const m = hs.cardModel(a, 'inspector')
    expect(m.star).toBe(true)
    expect(m.fee).toBe(0)
    expect(m.money).toBe(`$${a.salaryPerDay}/day · free`)
    expect(m.roleLine).toBe(
      `leaves in ${data.employees.applicants.starExpiryDays}d`,
    )
    expect(hs.cardModel({ ...a, leavesInDays: 0 }, 'inspector').roleLine).toBe(
      'leaves today',
    )
    expect(hs.cardModel({ ...a, leavesInDays: 1 }, 'inspector').roleLine).toBe(
      'leaves in 1d',
    )
  })

  it('every card line fits the narrowest card (360: 110 px, 6-px padding) in m5x7, at every pip corner', () => {
    const w = hs.hireCardRects(360)[0]!.w
    const inner = w - 2 * hs.CARD_PAD
    const corners: Record<Role, Pips[]> = {
      inspector: [
        { eye: 1, pace: 1, charisma: 0 },
        { eye: 5, pace: 5, charisma: 2 },
        { eye: 5, pace: 1, charisma: 2 },
      ],
      sorter: [
        { judgement: 1, pace: 1 },
        { judgement: 5, pace: 5 },
      ],
      driver: [
        { speed: 1, energy: 1, charisma: 0 },
        { speed: 5, energy: 5, charisma: 2 },
        { speed: 4, energy: 2, charisma: 1 },
      ],
    }
    const lines: string[] = []
    for (const role of ['inspector', 'sorter', 'driver'] as const)
      for (const pips of corners[role])
        for (const type of data.vehicles.types.map((t) => t.id)) {
          const m = hs.cardModel(view(role, pips, type, type), role)
          lines.push(m.numbers, m.money, m.roleLine, m.extra ?? '')
          // label + gap + the 5-pip row
          for (const r of m.pips)
            expect(
              width(r.label) + 4 + hs.pipsWidth(5),
              r.label,
            ).toBeLessThanOrEqual(inner)
        }
    lines.push('leaves in 2d', 'leaves today')
    for (const s of lines) expect(width(s), s).toBeLessThanOrEqual(inner)
    // Names: face (16) + 4 before, the ★ (16) + 2 after.
    for (const n of data.puns.peopleNames)
      expect(width(n), n).toBeLessThanOrEqual(inner - 20 - 18)
  })

  it('the buy-flow title and note share the title band at 360', () => {
    const x0 = hs.hireCardRects(360)[0]!.x
    for (const t of data.vehicles.types) {
      const room = 360 - 2 * x0 - width(hs.buyNote(t)) - 8
      expect(width(hs.buyTitle(t.name)), t.name).toBeLessThanOrEqual(room)
    }
    expect(hs.buyTitle('Bike')).toBe('Who drives the Bike?')
    expect(hs.buyNote({ name: 'Bike', price: 200 })).toBe('Bike $200 + fee')
  })
})

// ---- the sheet against a live sim ---------------------------------------------------

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
  const removed: unknown[] = []
  const sfx: unknown[] = []
  const game = { events: emitter() }
  game.events.on('ui:sfx', (p) => sfx.push(p))
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
    game,
    time: {
      addEvent: () => ({ remove() {} }),
      delayedCall: () => ({ remove() {} }),
    },
  }
  return { scene, removed, sfx }
}

function openSheet(
  vs: ReturnType<typeof createViewSim>,
  target: ConstructorParameters<typeof hs.HireSheet>[1]['target'],
  role: Role = 'driver',
  allowLater = false,
) {
  const { scene, removed, sfx } = fakeScene()
  const onDone = vi.fn()
  const onCancel = vi.fn()
  const sheet = new hs.HireSheet(scene as never, {
    vs,
    role,
    target,
    title: 'Who drives the Bike?',
    allowLater,
    W: 360,
    H: 604,
    minHit: 44,
    safeBottom: 0,
    onDone,
    onCancel,
  })
  return { sheet, scene, removed, sfx, onDone, onCancel }
}

describe('HireSheet against a live sim (design-m6 §6.1, §6.3)', () => {
  it('Garage buy flow: Hire on a card buys the vehicle with that driver (price + fee), closes and reports vehicleId / employeeId', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim)
    const before = modalCount()
    const { sheet, onDone, onCancel, removed } = openSheet(
      vs,
      { buyType: 'bike' },
      'driver',
      true,
    )
    expect(modalCount()).toBe(before + 1)
    expect(topModal()).toBe(sheet)
    const cards = sheet.cardModels
    expect(cards).toHaveLength(3)
    const pick = cards[1]!
    const money = vs.money
    const res = sheet.hire(1)
    expect(res).toMatchObject({ ok: true, vehicleId: 1 })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone.mock.calls[0]![0]).toMatchObject({ ok: true, vehicleId: 1 })
    expect(onCancel).not.toHaveBeenCalled()
    expect(sheet.isOpen()).toBe(false)
    expect(modalCount()).toBe(before)
    expect(removed).toContain(sheet.cam)
    expect(vs.money).toBe(money - 200 - pick.fee)
    const v = vs.vehicles[0]!
    expect(v.driverName).toBe(pick.name)
    // The hired applicant left the pool; a regular replaced them.
    expect(vs.applicants('driver').map((a) => a.id)).not.toContain(pick.id)
    expect(vs.applicants('driver')).toHaveLength(3)
  })

  it('B3 §3.6: buyPrice follows ViewSim.priceOf — a vehiclePrice ×0.5 card halves what Hire later needs and charges; 0 outside the buy flow', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim)
    const { sheet } = openSheet(vs, { buyType: 'bike' }, 'driver', true)
    expect(sheet.buyPrice()).toBe(200)
    applyModifier(sim, {
      key: 'vehiclePrice',
      mult: 0.5,
      add: 0,
      scope: null,
      untilTick: null,
      eventId: 'ev_test_sale',
      label: 'Test sale',
    })
    expect(sheet.buyPrice()).toBe(vs.priceOf('vehicle', 200))
    expect(sheet.buyPrice()).toBe(100)
    // A balance between the sale and the list price still buys.
    sim.state.economy.balance = 150
    const res = sheet.hireLater()
    expect(res).toMatchObject({ ok: true })
    expect(vs.money).toBe(50)
    expect(vs.vehicles[0]?.purchasePrice).toBe(100)
    // Outside the buy flow there is no vehicle price.
    const other = openSheet(vs, { vehicleId: vs.vehicles[0]!.id })
    expect(other.sheet.buyPrice()).toBe(0)
    other.sheet.close()
  })

  it('Hire later buys the vehicle without a driver: it parks inactive, `No driver`', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim)
    const { sheet, onDone } = openSheet(vs, { buyType: 'bike' }, 'driver', true)
    const money = vs.money
    const res = sheet.hireLater()
    expect(res).toMatchObject({ ok: true })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(vs.money).toBe(money - 200)
    expect(vs.vehicles[0]).toMatchObject({
      state: 'inactive',
      driverName: null,
      driverId: null,
    })
    // Not offered outside the buy flow.
    const other = openSheet(vs, { vehicleId: 1 })
    expect(other.sheet.hireLater()).toBeNull()
    other.sheet.close()
  })

  it('Replace through the sheet: on the lot the new driver takes over at once', () => {
    const sim = fund(quietSim(1))
    const v = buy(sim, 'bike')
    const old = v.driverId
    const vs = createViewSim(sim)
    const { sheet, onDone } = openSheet(vs, { vehicleId: v.id })
    const pick = sheet.cardModels[0]!
    expect(sheet.hire(0)).toMatchObject({ ok: true })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(v.driverId).not.toBe(old)
    expect(vs.vehicles[0]!.driverName).toBe(pick.name)
  })

  it('a stale card (the pool re-rolled under it) is refused: no-applicant, `deny`, the sheet stays open and re-reads the pool', () => {
    const sim = fund(quietSim(1))
    const vs = createViewSim(sim)
    const { sheet, scene, sfx, onDone } = openSheet(vs, { buyType: 'bike' })
    const stale = sheet.cardModels.map((c) => c.id)
    expect(vs.postAd('driver').ok).toBe(true) // e.g. another device / a day boundary
    const res = sheet.hire(0)
    expect(res).toMatchObject({ ok: false, reason: 'no-applicant' })
    expect(sfx).toContainEqual({ name: 'deny' })
    expect(sheet.isOpen()).toBe(true)
    expect(onDone).not.toHaveBeenCalled()
    expect(vs.vehicles).toHaveLength(0)
    scene.events.emit('update')
    const fresh = sheet.cardModels.map((c) => c.id)
    expect(fresh).toHaveLength(3)
    expect(fresh.some((id) => stale.includes(id))).toBe(false)
    expect(sheet.hire(0)).toMatchObject({ ok: true })
  })

  it('Post an ad re-rolls the pool for applicants.adPrice; without the money it is refused with `deny`', () => {
    const sim = fund(quietSim(1))
    const vs = createViewSim(sim)
    const { sheet, sfx } = openSheet(vs, { buyType: 'bike' })
    const ids = sheet.cardModels.map((c) => c.id)
    const money = vs.money
    expect(sheet.postAd()).toMatchObject({ ok: true })
    expect(vs.money).toBe(money - data.employees.applicants.adPrice)
    const after = sheet.applicants().map((a) => a.id)
    expect(after.some((id) => ids.includes(id))).toBe(false)
    sim.state.economy.balance = 0
    expect(sheet.postAd()).toMatchObject({
      ok: false,
      reason: 'insufficient-funds',
    })
    expect(sfx).toContainEqual({ name: 'deny' })
  })

  it('the Hire buttons follow the balance: price + fee in the buy flow', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim)
    const { sheet, scene } = openSheet(vs, { buyType: 'bike' }, 'driver', true)
    const btns = () =>
      (
        sheet as unknown as {
          cards: { btn: { isEnabled(): boolean } }[]
        }
      ).cards.map((c) => c.btn.isEnabled())
    expect(btns()).toEqual([true, true, true])
    sim.state.economy.balance = 200 // the bike, not the fee
    scene.events.emit('update')
    expect(btns()).toEqual([false, false, false])
    expect(sheet.hire(0)).toMatchObject({
      ok: false,
      reason: 'insufficient-funds',
    })
    // `Hire later` needs only the price.
    expect(sheet.hireLater()).toMatchObject({ ok: true })
  })

  it('Esc and a vanished target cancel (onCancel); a sleeping scene closes it silently', () => {
    const sim = fund(quietSim(1))
    const vs = createViewSim(sim)
    // Esc (the sheet is the top modal)
    const a = openSheet(vs, { buyType: 'bike' })
    a.scene.input.keyboard.emit('keydown', { key: 'Escape' })
    expect(a.sheet.isOpen()).toBe(false)
    expect(a.onCancel).toHaveBeenCalledTimes(1)
    // the vehicle being replaced was sold
    buy(sim, 'bike')
    const v2 = buy(sim, 'bike')
    const b = openSheet(vs, { vehicleId: v2.id })
    expect(vs.sellVehicle(v2.id).ok).toBe(true)
    b.scene.events.emit('update')
    expect(b.sheet.isOpen()).toBe(false)
    expect(b.onCancel).toHaveBeenCalledTimes(1)
    // sleep: closed, no callback, off the modal stack, listeners dropped
    const before = modalCount()
    const c = openSheet(vs, { buyType: 'bike' })
    expect(modalCount()).toBe(before + 1)
    c.scene.events.emit('sleep')
    expect(c.sheet.isOpen()).toBe(false)
    expect(c.onCancel).not.toHaveBeenCalled()
    expect(c.onDone).not.toHaveBeenCalled()
    expect(modalCount()).toBe(before)
    expect(c.scene.events.count('update')).toBe(0)
    expect(c.scene.events.count('shutdown')).toBe(0)
    expect(c.scene.input.keyboard.count('keydown')).toBe(0)
  })

  it('an inspector sheet hires into the desk node it was opened for', () => {
    const sim = fund(quietSim(1))
    const vs = createViewSim(sim)
    const desk = vs.lane.nodes().find((n) => n.fixture?.kind === 'desk')!
    const { sheet, onDone } = openSheet(vs, { nodeId: desk.id }, 'inspector')
    const pick = sheet.cardModels[0]!
    expect(pick.role).toBe('inspector')
    expect(sheet.hire(0)).toMatchObject({ ok: true })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(vs.people().find((p) => p.name === pick.name)?.nodeId).toBe(desk.id)
  })
})
