// city-view.md §7 (Garage sheet: geometry, rows, buy cards, footer), §6.2
// (ZonePicker), spec §4.1 (sell refund 50 %, last vehicle unsellable, home
// zones, Industrial trucks only), §4.6 (state text), §7.3-§7.4 (payday,
// salaries, re-hire fee); M6 (spec-build2 §2.5, design-m6 §6.3): the driver
// block (name, ★, compact pips, affinity, pay / `! unpaid` / a waiting
// Replace), the action slot (Hire driver / Re-hire / `···`), the popover
// (Replace / Fire / Sell) and the buy, Replace and Fire copy. Pure helpers
// only; Phaser is stubbed because the modules import the Button kit (Phaser
// cannot load under Node).
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => {
  // Base classes the kit extends at module load (Container, Scene).
  class Stub {
    readonly stub = true
  }
  return {
    default: {
      Scene: Stub,
      GameObjects: { Container: Stub, NineSlice: Stub, Image: Stub },
      Geom: { Rectangle: Stub },
    },
  }
})

const garage = await import('../../src/scenes/GarageSheet.ts')
const zp = await import('../../src/ui/ZonePicker.ts')
const { followIconPos } = await import('../../src/ui/FollowStrip.ts')
const { salaryOf } = await import('../../src/sim/systems/people.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const {
  buy,
  dataFixture,
  fund,
  injectParcel,
  makeSim,
  quietSim,
  runUntil,
  standardApplicant,
} = await import('../sim/helpers.ts')

import type { VehicleSnapshot } from '../../src/sim/view-api.ts'

const data = dataFixture()
/** A stand-in for BitmapText width: 6 px per character. */
const measure = (s: string): number => s.length * 6

function snap(over: Partial<VehicleSnapshot> = {}): VehicleSnapshot {
  return {
    id: 1,
    type: 'bike',
    name: 'Bike 1',
    driverName: 'Dee',
    driverId: 7,
    driverPips: { speed: 3, energy: 3, charisma: 0 },
    driverStar: false,
    driverAffinity: 'none',
    nextDriverName: null,
    state: 'idle_lot',
    prev: { tx: 0, ty: 0 },
    cur: { tx: 0, ty: 0 },
    heading: 'sw',
    wheel: 0,
    stopAt: null,
    cargo: [],
    queuePos: null,
    dockId: null,
    zone: 'any',
    unpaid: false,
    rushBuildingId: null,
    stopsLeft: 0,
    unitsUsed: 0,
    capacityUnits: 4,
    ...over,
  }
}

describe('Garage sheet geometry (city-view §7, §7.2-§7.3)', () => {
  it('the sheet is capped at max(320, round(H × 0.6))', () => {
    expect(garage.garageSheetHeight(500)).toBe(320)
    expect(garage.garageSheetHeight(659)).toBe(395)
    expect(garage.garageSheetHeight(932)).toBe(559)
  })

  it('the fleet list sits between the 56-px header and the buy block, above the safe area (at most)', () => {
    expect(garage.garageListHeight(659, 0)).toBe(395 - 56 - 120)
    expect(garage.garageListHeight(932, 34)).toBe(559 - 56 - 120 - 34)
    expect(garage.garageListHeight(500, 200)).toBe(garage.ROW_PITCH)
  })

  it('report §6.14: the list fits the fleet (one pitch per vehicle, one for the empty state), then scrolls', () => {
    const P = garage.ROW_PITCH
    const pad = garage.LIST_PAD
    expect(garage.garageListHeight(932, 34, 0)).toBe(P + pad)
    expect(garage.garageListHeight(932, 34, 1)).toBe(P + pad)
    expect(garage.garageListHeight(932, 34, 3)).toBe(3 * P + pad)
    // 349 px of list at 430×932 (safe 34): six rows fit, the seventh scrolls.
    expect(garage.garageListHeight(932, 34, 6)).toBe(6 * P + pad)
    expect(garage.garageListHeight(932, 34, 7)).toBe(
      garage.garageListHeight(932, 34),
    )
    expect(garage.garageListHeight(604, 0, 40)).toBe(
      garage.garageListHeight(604, 0),
    )
  })

  it('report §6.14: the sheet height is header + list + buy block + safe area, never over the cap', () => {
    const fit = (H: number, sb: number, n: number) =>
      garage.garageFitHeight(H, sb, n)
    // 430×932 with two vehicles: 56 + 116 + 120 + 34 (was 559, ~230 px empty).
    expect(fit(932, 34, 2)).toBe(56 + 2 * garage.ROW_PITCH + 4 + 120 + 34)
    for (const [H, sb] of [
      [604, 0],
      [659, 0],
      [659, 34],
      [932, 34],
    ] as const) {
      for (let n = 0; n <= 12; n++) {
        const h = fit(H, sb, n)
        expect(h, `${H}/${sb}/${n}`).toBeLessThanOrEqual(
          Math.max(garage.garageSheetHeight(H), 56 + 56 + 120 + sb),
        )
        expect(h - 56 - 120 - sb).toBe(garage.garageListHeight(H, sb, n))
        expect(fit(H, sb, n + 1)).toBeGreaterThanOrEqual(h)
      }
    }
  })

  it('plan-build2 §8.2 task 5: the buy-card sprite and row icon are placed from the frame size', () => {
    // The bike's 24² playtest-1 canvas and its 32² build-2 one, the van, the truck.
    expect(garage.cardSpritePos(24, 24)).toEqual({ x: 18, y: 12 })
    expect(garage.cardSpritePos(32, 32)).toEqual({ x: 14, y: 4 })
    expect(garage.cardSpritePos(48, 32)).toEqual({ x: 6, y: 4 })
    // Larger than the 48×32 box: pinned to its top-left, never left of it.
    expect(garage.cardSpritePos(64, 40)).toEqual({ x: 6, y: 4 })
    // The 16² type icon keeps its playtest-1 spot (x 20, centred in 56).
    expect(garage.rowIconPos(16, 16)).toEqual({ x: 20, y: 20 })
    expect(garage.rowIconPos(24, 24)).toEqual({ x: 16, y: 16 })
  })

  it('plan-build2 §8.2 task 5: the follow strip places its type glyph from the frame size', () => {
    // The 32-px strip at y 500: the 16² icon keeps its playtest-1 spot.
    expect(followIconPos(16, 16, 500, 32)).toEqual({ x: 6, y: 508, textX: 26 })
    // A 32² frame fills the strip and pushes the text right.
    expect(followIconPos(32, 32, 500, 32)).toEqual({ x: 6, y: 500, textX: 42 })
    expect(followIconPos(24, 24, 500, 32)).toEqual({ x: 6, y: 504, textX: 34 })
  })

  it('three buy cards with 8-px gaps fit inside W − 24 at every target width', () => {
    for (const W of [360, 393, 430]) {
      const w = garage.cardWidth(W)
      expect(3 * w + 2 * garage.CARD_GAP).toBeLessThanOrEqual(W - 24)
      expect(w).toBeGreaterThanOrEqual(100)
    }
  })

  it('row columns (name, status, zone chip, the ··· slot) never overlap from W 360 to 430', () => {
    for (const W of [360, 393, 430]) {
      const c = garage.rowColumns(W)
      expect(c.nameX + c.nameW).toBeLessThanOrEqual(c.statusX)
      expect(c.statusX + c.statusW).toBeLessThanOrEqual(c.zoneX)
      expect(c.zoneX + garage.ZONE_W).toBeLessThanOrEqual(c.actionX)
      // the 44-px ··· sits at the row's right edge (no empty slot beside it)
      expect(c.actionX + garage.MORE_W).toBe(W - 12 - 6)
      expect(c.nameW).toBeGreaterThanOrEqual(64) // `Dee · $8/day`
      expect(c.statusW).toBeGreaterThanOrEqual(60)
    }
  })
})

describe('Garage rows: state, driver, sell / re-hire (spec §4.1, §4.6, §7.4)', () => {
  it('sell refund = vehicles.json price × economy.sellRefund (bike $100, van $500, truck $600)', () => {
    expect(garage.sellRefund(data, 'bike')).toBe(100)
    expect(garage.sellRefund(data, 'van')).toBe(500)
    const truck = data.vehicles.types.find((t) => t.id === 'truck')!
    expect(garage.sellRefund(data, 'truck')).toBe(
      Math.round(truck.price * data.economy.sellRefund),
    )
  })

  it('the last vehicle cannot be sold: Sell (in the ··· popover) disabled with "Keep at least one vehicle"', () => {
    expect(garage.sellAction(snap(), data, 1)).toEqual({
      label: 'Sell $100',
      enabled: false,
      tip: 'Keep at least one vehicle',
    })
    const two = garage.sellAction(snap(), data, 2)
    expect(two.enabled).toBe(true)
    expect(two.tip).toBeNull()
    // A driven row's action slot is the ··· popover whatever the fleet size.
    expect(garage.rowAction(snap(), data, 1, true)).toEqual({
      kind: 'more',
      label: garage.MORE_LABEL,
      enabled: true,
      tip: null,
    })
  })

  it('design-m6 §6.3: the ··· popover lists Replace driver, Fire driver, Sell (last vehicle: disabled + tip)', () => {
    const items = garage.menuItems(snap({ type: 'van' }), data, 3)
    expect(items.map((i) => [i.kind, i.label, i.enabled])).toEqual([
      ['replace', 'Replace driver', true],
      ['fire', 'Fire driver', true],
      ['sell', 'Sell $500', true],
    ])
    const last = garage.menuItems(snap(), data, 1)[2]
    expect(last).toMatchObject({
      kind: 'sell',
      enabled: false,
      tip: 'Keep at least one vehicle',
    })
    expect(garage.menuHeight(3)).toBe(4 + 3 * 44 + 2 * 2 + 4)
  })

  it('M6 integration: a driverless row keeps Sell (and Fire for a walked-out driver) in its ··· popover, its primary action first', () => {
    const none = snap({ state: 'inactive', driverName: null, driverId: null })
    const hire = garage.rowAction(none, data, 3, true)
    expect(
      garage.menuItems(none, data, 3, hire).map((i) => [i.kind, i.label]),
    ).toEqual([
      ['hire', 'Hire driver'],
      ['sell', 'Sell $100'],
    ])
    const out = snap({ state: 'inactive', driverName: null })
    const rehire = garage.rowAction(out, data, 3, true, 24)
    expect(
      garage
        .menuItems(out, data, 3, rehire)
        .map((i) => [i.kind, i.label, i.enabled]),
    ).toEqual([
      ['rehire', 'Re-hire $24', true],
      ['fire', 'Fire driver', true],
      ['sell', 'Sell $100', true],
    ])
    // Before payroll ships the Re-hire item is disabled with its tip.
    expect(
      garage.menuItems(out, data, 3, garage.rowAction(out, data, 3, false))[0],
    ).toMatchObject({
      kind: 'rehire',
      enabled: false,
      tip: 'Not available yet',
    })
    // The last vehicle still cannot be sold from a driverless row.
    expect(garage.menuItems(none, data, 1, hire)[1]).toMatchObject({
      kind: 'sell',
      enabled: false,
    })
    // A driven row (or no primary) keeps Replace / Fire / Sell.
    expect(
      garage
        .menuItems(snap(), data, 3, garage.rowAction(snap(), data, 3, true))
        .map((i) => i.kind),
    ).toEqual(['replace', 'fire', 'sell'])
  })

  it('a walked-out row offers Re-hire for one day of that driver’s salary (class base without one), enabled only once payroll ships', () => {
    const v = snap({ type: 'van', state: 'inactive', driverName: null })
    expect(garage.rehireCost(data, 'van')).toBe(15)
    expect(garage.rehireCost(data, 'van', 18)).toBe(18)
    expect(garage.rowAction(v, data, 3, false)).toMatchObject({
      kind: 'rehire',
      label: 'Re-hire $15',
      enabled: false,
    })
    expect(garage.rowAction(v, data, 3, true).enabled).toBe(true)
    // M6: the walked-out driver's own pay (a 5/5/2 van driver earns $24).
    expect(garage.rowAction(v, data, 3, true, 24).label).toBe('Re-hire $24')
    // Still finishing its trip after the walkout: Re-hire at once (§7.4).
    expect(
      garage.rowAction(
        snap({ driverName: null, state: 'delivering' }),
        data,
        3,
        true,
      ),
    ).toMatchObject({ kind: 'rehire', label: 'Re-hire $8' })
    // M6 review: no Re-hire while a Replace waits for this vehicle (the swap
    // lets the walked-out driver go anyway) — Replace / Fire / Sell instead.
    for (const state of ['inactive', 'delivering'] as const) {
      const pending = snap({ state, driverName: null, nextDriverName: 'Rae' })
      const a = garage.rowAction(pending, data, 3, true, 24)
      expect(a.kind).toBe('more')
      expect(garage.menuItems(pending, data, 3, a).map((i) => i.kind)).toEqual([
        'replace',
        'fire',
        'sell',
      ])
    }
  })

  it('M6: a vehicle with no driver at all (Hire later, a fire) offers Hire driver', () => {
    for (const state of ['inactive', 'delivering'] as const) {
      expect(
        garage.rowAction(
          snap({ state, driverName: null, driverId: null }),
          data,
          3,
          true,
        ),
      ).toEqual({
        kind: 'hire',
        label: 'Hire driver',
        enabled: true,
        tip: null,
      })
    }
  })

  it('state text follows the §4.6 states', () => {
    const cases: [VehicleSnapshot['state'], number | null, string][] = [
      ['idle_lot', null, 'Idle'],
      ['queued', 1, 'Queued #2'],
      ['docked_unloading', null, 'Unloading'],
      ['docked_loading', null, 'Loading'],
      ['delivering', null, 'Delivering'],
      ['collecting', null, 'Collecting'],
      ['returning', null, 'Returning'],
      ['inactive', null, 'No driver'],
    ]
    for (const [state, queuePos, text] of cases)
      expect(garage.stateText({ state, queuePos })).toBe(text)
  })

  it('status shows "Delivering · N stops" over the units when it fits, else splits the stops onto the units line', () => {
    const v = snap({
      state: 'delivering',
      stopsLeft: 3,
      unitsUsed: 3,
      capacityUnits: 4,
    })
    expect(garage.statusLines(v, 200, measure)).toEqual([
      'Delivering · 3 stops',
      '3/4',
    ])
    expect(garage.statusLines(v, 80, measure)).toEqual([
      'Delivering',
      '3/4 · 3 stops',
    ])
    expect(
      garage.statusLines(
        snap({ state: 'delivering', stopsLeft: 1 }),
        200,
        measure,
      )[0],
    ).toBe('Delivering · 1 stop')
    expect(
      garage.statusLines(
        snap({ state: 'inactive', driverName: null }),
        80,
        measure,
      ),
    ).toEqual(['No driver', ''])
  })

  it('driver name line: the active driver, red "Dee left" after a walkout, red "No driver" with none', () => {
    expect(garage.driverLine(snap(), data)).toEqual({
      text: 'Dee',
      red: false,
    })
    expect(garage.driverLine(snap({ driverName: null }), data).text).toBe(
      'No driver',
    )
    // with the walked-out driver's name: who the Re-hire button brings back
    expect(garage.driverLine(snap({ driverName: null }), data, 'Dee')).toEqual({
      text: 'Dee left',
      red: true,
    })
  })

  it('design-m6 §6.3: the driver block reads name, compact pips, affinity and pay; red "! unpaid"; "→ Rae after this trip" while a Replace waits', () => {
    const dee = { name: 'Dee', salaryPerDay: 9 }
    const base = garage.driverRow(
      snap({
        driverPips: { speed: 4, energy: 3, charisma: 1 },
        driverAffinity: 'bike',
        driverStar: true,
      }),
      dee,
      data,
    )
    expect(base).toMatchObject({
      name: 'Dee',
      nameRed: false,
      star: true,
      dim: false,
      affinity: 'bike',
      tail: ['$9/day', '$9'],
      tailRed: false,
    })
    expect(
      base.pips?.map((r) => [r.label, r.on.filter(Boolean).length]),
    ).toEqual([
      ['speed', 4],
      ['energy', 3],
      ['charisma', 1],
    ])
    expect(base.pips?.map((r) => r.on.length)).toEqual([5, 5, 2])
    // affinity 'none' draws no icon
    expect(garage.driverRow(snap(), dee, data).affinity).toBeNull()
    const unpaid = garage.driverRow(snap({ unpaid: true }), dee, data)
    expect(unpaid).toMatchObject({ tail: ['! unpaid', '!'], tailRed: true })
    const pending = garage.driverRow(snap({ nextDriverName: 'Rae' }), dee, data)
    expect(pending.tail[0]).toBe('→ Rae after this trip')
    expect(pending.tail.at(-1)).toBe('→ Rae')
    // walked out: red `Dee left`, its pips dimmed
    const left = garage.driverRow(snap({ driverName: null }), dee, data)
    expect(left).toMatchObject({ name: 'Dee left', nameRed: true, dim: true })
    // no driver: `No driver` while it still drives its last trip; blank when
    // parked (the status column already reads `No driver`)
    const none = { driverName: null, driverId: null, driverPips: null }
    expect(
      garage.driverRow(snap({ ...none, state: 'delivering' }), null, data),
    ).toMatchObject({ name: 'No driver', nameRed: true, pips: null, tail: [] })
    expect(
      garage.driverRow(snap({ ...none, state: 'inactive' }), null, data).name,
    ).toBe('')
  })

  it('the third line keeps inside the name + status columns at W 360: the tail falls back to what fits', () => {
    const col = garage.rowColumns(360)
    const end = col.zoneX - 4
    const rows = garage.driverRow(
      snap({ driverAffinity: 'truck' }),
      { name: 'Dee', salaryPerDay: 13 },
      data,
    )
    const lay = garage.driverLineLayout(rows.pips ?? [], true, end)
    expect(lay.pipX).toEqual([42, 82, 122])
    expect(lay.iconX).toBe(141)
    expect(lay.tailX + lay.tailW).toBe(end)
    // M6 review: with the chip placed from the 44-px ··· slot the tail gets
    // 59 px at 360 — the pay, `! unpaid` and `→ Audrey` all fit in full.
    expect(lay.tailW).toBe(59)
    expect(garage.fitTail(rows.tail, lay.tailW, measure)).toBe('$13/day')
    expect(garage.fitTail(['! unpaid', '!'], lay.tailW, measure)).toBe(
      '! unpaid',
    )
    expect(
      garage.fitTail(
        ['→ Audrey after this trip', '→ Audrey'],
        lay.tailW,
        measure,
      ),
    ).toBe('→ Audrey')
    expect(garage.fitTail(rows.tail, 30, measure)).toBe('$13')
    expect(garage.fitTail(rows.tail, 200, measure)).toBe('$13/day')
    expect(
      garage.fitTail(['→ Rae after this trip', '→ Rae'], 40, measure),
    ).toBe('→ Rae')
    expect(garage.fitTail([], 40, measure)).toBe('')
    // At 393 the pay fits in full next to an affinity icon.
    const wide = garage.rowColumns(393)
    const lay2 = garage.driverLineLayout(rows.pips ?? [], true, wide.zoneX - 4)
    expect(garage.fitTail(rows.tail, lay2.tailW, measure)).toBe('$13/day')
  })

  it('the longest Re-hire / Hire driver, popover and zone-chip labels keep Button.CONTENT_PAD of air in m5x7 (UX M3: `Re-hire $25` touched its 64-px face)', async () => {
    const { readFileSync } = await import('node:fs')
    const xml = readFileSync(
      new URL('../../src/assets/m5x7.xml', import.meta.url),
      'utf8',
    )
    const adv = new Map<number, number>()
    for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
      adv.set(Number(m[1]), Number(m[2]))
    const width = (s: string): number =>
      [...s].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 6), 0)
    const { CONTENT_PAD } = await import('../../src/ui/Button.ts')
    // M6: the dearest driver of each class (5/5/2) sets the longest Re-hire.
    const top = { speed: 5, energy: 5, charisma: 2 }
    const actions = data.vehicles.types.flatMap((t) => [
      garage.rowAction(
        { state: 'inactive', type: t.id, driverName: null, driverId: 3 },
        data,
        3,
        true,
        salaryOf(data, 'driver', top, t.id),
      ).label,
      garage.rowAction(
        { state: 'inactive', type: t.id, driverName: null, driverId: null },
        data,
        3,
        true,
      ).label,
    ])
    expect(actions).toContain('Re-hire $40')
    // Hire driver / Re-hire are popover items (the slot is always ···).
    for (const label of actions)
      expect(width(label), label).toBeLessThanOrEqual(
        garage.MENU_W - 8 - 2 * CONTENT_PAD,
      )
    const menu = data.vehicles.types.flatMap((t) =>
      garage.menuItems({ type: t.id }, data, 3).map((i) => i.label),
    )
    for (const label of menu)
      expect(width(label), label).toBeLessThanOrEqual(
        garage.MENU_W - 8 - 2 * CONTENT_PAD,
      )
    const chips = ['any', 'highres', 'downtown', 'industrial'].map((z) =>
      zp.zoneChipText(data, data.map, z as never),
    )
    for (const label of chips)
      expect(width(label), label).toBeLessThanOrEqual(
        garage.ZONE_W - 2 * CONTENT_PAD,
      )
  })

  it('header strings: fleet size, payday countdown from ticksToPayday, payroll per day', () => {
    expect(garage.fleetTitle(3)).toBe('Garage · Fleet 3')
    expect(garage.paydayText(230)).toBe('Payday in 0:23')
    expect(garage.paydayText(600)).toBe('Payday in 1:00')
    expect(garage.paydayText(1)).toBe('Payday in 0:01')
    expect(garage.payrollText(44)).toBe('Payroll $44/day')
  })

  it('toast, sell prompt and footer copy come from the data tables', () => {
    expect(garage.boughtToast('Bike 2', 'Dee')).toBe(
      'Bike 2 bought — Dee hired',
    )
    expect(garage.boughtToast('Bike 2', null)).toBe(
      'Bike 2 bought — no driver yet',
    )
    expect(garage.driveToast('Rae', 'Bike 2', true)).toBe(
      'Rae takes over Bike 2 after this trip',
    )
    expect(garage.driveToast('Rae', 'Bike 2', false)).toBe(
      'Rae now drives Bike 2',
    )
    expect(garage.replaceTitle('Dee', 'Bike 2')).toBe('Replace Dee · Bike 2')
    expect(garage.driverForTitle('Bike 2')).toBe('Driver for Bike 2')
    const v = { name: 'Bike 2', nextDriverName: null }
    expect(garage.firePrompt('Dee', { ...v, state: 'idle_lot' })).toBe(
      'Fire Dee? Bike 2 parks with no driver.',
    )
    expect(garage.firePrompt('Dee', { ...v, state: 'delivering' })).toBe(
      'Fire Dee? Bike 2 finishes its trip, then parks.',
    )
    expect(
      garage.firePrompt('Dee', {
        ...v,
        state: 'delivering',
        nextDriverName: 'Rae',
      }),
    ).toBe('Fire Dee? Rae takes over Bike 2 now.')
    expect(
      garage.firedToast('Dee', {
        name: 'Bike 2',
        state: 'inactive',
        driverName: null,
      }),
    ).toBe('Dee fired — Bike 2 has no driver')
    expect(
      garage.firedToast('Dee', {
        name: 'Bike 2',
        state: 'delivering',
        driverName: null,
      }),
    ).toBe('Dee fired — Bike 2 parks after this trip')
    expect(
      garage.firedToast('Dee', {
        name: 'Bike 2',
        state: 'delivering',
        driverName: 'Rae',
      }),
    ).toBe('Dee fired — Rae now drives Bike 2')
    expect(garage.sellPrompt('Bike 2', 100)).toBe(
      'Sell Bike 2 for $100? Its parcels go back to the warehouse.',
    )
    expect(garage.footerText(data)).toBe(
      'Sold vehicles refund 50%. Drivers are paid every day (60 s).',
    )
  })
})

describe('Garage buy cards (city-view §7.3)', () => {
  it('one card per vehicles.json type with price, capacity, salary and speed pips ranked by speed', () => {
    const cards = garage.buyCards(data, 450, 1)
    expect(cards.map((c) => c.type)).toEqual(['bike', 'van', 'truck'])
    const [bike, van, truck] = cards
    expect(bike).toMatchObject({
      name: 'Bike',
      priceText: '$200',
      capacity: '4 units · S M',
      salaryText: '$8/day',
      pips: 2,
      maxPips: 3,
    })
    expect(van?.capacity).toBe('16 units · S M L')
    expect(van?.pips).toBe(3)
    expect(truck?.capacity).toBe('32 units · S M L XL')
    expect(truck?.capacityCompact).toBe('32 units · S–XL')
    expect(truck?.pips).toBe(1)
  })

  it('the truck is locked before Lv 2 ("Unlocks at Lv 2"); unaffordable cards are disabled', () => {
    const l1 = garage.buyCards(data, 450, 1)
    expect(l1[0]).toMatchObject({
      enabled: true,
      affordable: true,
      locked: false,
    })
    expect(l1[1]).toMatchObject({
      enabled: false,
      affordable: false,
      locked: false,
    })
    expect(l1[2]).toMatchObject({
      enabled: false,
      locked: true,
      lockText: 'Unlocks at Lv 2',
    })
    expect(garage.buyDeniedToast(l1[2]!)).toBe('Truck — unlocks at Lv 2')
    expect(garage.buyDeniedToast(l1[1]!)).toBe(
      'Not enough money — Van costs $1,000',
    )
    const l2 = garage.buyCards(data, 5000, 2)
    expect(l2.every((c) => c.enabled)).toBe(true)
  })

  it('compact capacity collapses only contiguous runs of three or more sizes', () => {
    expect(
      garage.capacityText({ capacityUnits: 4, sizes: ['S', 'M'] }, true),
    ).toBe('4 units · S M')
    expect(
      garage.capacityText({ capacityUnits: 16, sizes: ['S', 'M', 'L'] }, true),
    ).toBe('16 units · S–L')
    expect(
      garage.capacityText({ capacityUnits: 9, sizes: ['S', 'L', 'XL'] }, true),
    ).toBe('9 units · S L XL')
  })
})

/** Row model for vehicle `id` as the scene builds it (ViewSim only). */
function rowOf(vs: ReturnType<typeof createViewSim>, id: number) {
  const v = vs.vehicles.find((x) => x.id === id)!
  const d =
    v.driverId === null
      ? null
      : (vs.people().find((p) => p.id === v.driverId) ?? null)
  return {
    v,
    d,
    row: garage.driverRow(v, d, vs.data),
    action: garage.rowAction(
      v,
      vs.data,
      vs.vehicles.length,
      true,
      d?.salaryPerDay ?? null,
    ),
  }
}

describe('Garage rows against a live sim (spec §7.1, §4.1; M6 design §4.5, §6.3)', () => {
  it('a new game has no vehicle (empty state); the first bike, bought with a picked driver, reads Idle, the driver, pips, pay, Any ▾, ···, Sell disabled', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    expect(vs.vehicles).toHaveLength(0)
    const pick = vs.applicants('driver', 'bike')[0]!
    const res = vs.buyVehicle('bike', pick.id)
    expect(res).toMatchObject({ ok: true, vehicleId: 1 })
    const { v, d, row, action } = rowOf(vs, 1)
    expect(v.name).toBe('Bike 1')
    expect(garage.stateText(v)).toBe('Idle')
    expect(d?.name).toBe(pick.name)
    expect(row.name).toBe(pick.name)
    expect(row.tail[0]).toBe(`$${pick.salaryPerDay}/day`)
    expect(row.pips?.map((r) => r.on.filter(Boolean).length)).toEqual([
      pick.pips.speed,
      pick.pips.energy,
      pick.pips.charisma,
    ])
    expect(zp.zoneChipText(vs.data, vs.map, v.zone)).toBe('Any ▾')
    expect(action.kind).toBe('more')
    expect(garage.sellAction(v, vs.data, vs.vehicles.length).enabled).toBe(
      false,
    )
    expect(garage.unitsText(v)).toBe('0/4')
  })

  it('Hire later parks it No driver with a Hire driver button; hiring into it puts it on the road', () => {
    const sim = fund(quietSim(1))
    const vs = createViewSim(sim)
    const res = vs.buyVehicle('bike', null)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const id = res.vehicleId!
    let r = rowOf(vs, id)
    expect(r.v.state).toBe('inactive')
    expect(garage.stateText(r.v)).toBe('No driver')
    expect(r.row.name).toBe('') // the status column says it
    expect(r.action).toMatchObject({ kind: 'hire', label: 'Hire driver' })
    const a = vs.applicants('driver', 'bike')[1]!
    expect(vs.hire('driver', a.id, { vehicleId: id }).ok).toBe(true)
    r = rowOf(vs, id)
    expect(r.v.state).toBe('idle_lot')
    expect(r.row.name).toBe(a.name)
    expect(r.action.kind).toBe('more')
  })

  it('Replace mid-trip: the row reads "→ Rae after this trip" until the unload; Fire on the lot parks it No driver', () => {
    const sim = fund(quietSim(1))
    const v0 = buy(sim, 'bike')
    const vs = createViewSim(sim)
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expect(runUntil(sim, () => v0.cargo.length > 0, 3000)).toBeGreaterThan(0)
    const rae = standardApplicant(sim, 'driver')
    expect(vs.hire('driver', rae.id, { vehicleId: v0.id }).ok).toBe(true)
    let r = rowOf(vs, v0.id)
    expect(r.v.nextDriverName).toBe(rae.name)
    expect(r.row.tail[0]).toBe(`→ ${rae.name} after this trip`)
    expect(vs.people().find((p) => p.name === rae.name)?.pending).toBe(true)
    expect(runUntil(sim, () => v0.nextDriverId === null, 3000)).toBeGreaterThan(
      0,
    )
    r = rowOf(vs, v0.id)
    expect(r.row.name).toBe(rae.name)
    expect(r.row.tail[0]).toMatch(/^\$\d+\/day$/)
    expect(runUntil(sim, () => v0.state === 'idle_lot', 3000)).toBeGreaterThan(
      -1,
    )
    const driver = r.d!
    expect(vs.fire(driver.id).ok).toBe(true)
    r = rowOf(vs, v0.id)
    expect(r.v.state).toBe('inactive')
    expect(r.v.driverName).toBeNull()
    expect(r.action.kind).toBe('hire')
    expect(garage.firedToast(driver.name, r.v)).toBe(
      `${driver.name} fired — ${r.v.name} has no driver`,
    )
  })
})

const liveAtL1 = (id: string): boolean => id === 'highres' || id === 'downtown'
const allLive = (): boolean => true

describe('ZonePicker (city-view §6.2, spec §4.1 home zones)', () => {
  it('lists Any, the live districts by flavour name, then the locked ones; hubs are never listed', () => {
    const opts = zp.zoneOptions(data, 'truck', liveAtL1, 'any')
    expect(opts.map((o) => o.label)).toEqual([
      'Any',
      'Node Heights',
      'Registry Row',
      'Hoist Hill',
      'Semver Street',
      'Pasture Peer Fields',
      'Monorepo Commons',
    ])
    expect(opts.map((o) => o.zone)).not.toContain('docks')
    expect(opts.map((o) => o.zone)).not.toContain('airport')
    expect(opts.slice(0, 3).every((o) => o.enabled)).toBe(true)
    expect(opts.slice(3).every((o) => !o.enabled)).toBe(true)
    expect(opts.find((o) => o.zone === 'industrial')?.note).toBe('Lv 2')
    expect(opts.find((o) => o.zone === 'civic')?.note).toBe('Lv 5')
  })

  it('Industrial is greyed "Trucks only" for bikes and vans, even once it is live', () => {
    for (const type of ['bike', 'van'] as const) {
      const ind = zp
        .zoneOptions(data, type, allLive, 'any')
        .find((o) => o.zone === 'industrial')
      expect(ind).toMatchObject({ enabled: false, note: 'Trucks only' })
    }
    const truck = zp
      .zoneOptions(data, 'truck', allLive, 'any')
      .find((o) => o.zone === 'industrial')
    expect(truck).toMatchObject({ enabled: true, note: '' })
  })

  it('marks the current zone', () => {
    const opts = zp.zoneOptions(data, 'bike', liveAtL1, 'downtown')
    expect(opts.filter((o) => o.current).map((o) => o.zone)).toEqual([
      'downtown',
    ])
  })

  it('chip text uses map.json chipLabel', () => {
    expect(zp.zoneChipText(data, data.map, 'any')).toBe('Any ▾')
    expect(zp.zoneChipText(data, data.map, 'highres')).toBe('Heights ▾')
    expect(zp.zoneChipText(data, data.map, 'industrial')).toBe('Hoist Hill ▾')
  })

  it('opens above its chip when there is room, else below, always on screen', () => {
    const W = 393
    const H = 659
    const chip = { x: 233, y: 400, w: 74, h: 28 }
    expect(zp.placePopover(chip, 196, 200, W, H)).toEqual({ x: 111, y: 196 })
    const high = { x: 233, y: 100, w: 74, h: 28 }
    expect(zp.placePopover(high, 196, 200, W, H).y).toBe(132)
    const left = { x: 0, y: 400, w: 20, h: 28 }
    expect(zp.placePopover(left, 196, 200, W, H).x).toBe(4)
    const tall = zp.placePopover(high, 196, 640, W, H)
    expect(tall.y + 640).toBeLessThanOrEqual(H - 4)
  })

  it('selectable rows are full 44-px targets; greyed rows are compact lines', () => {
    const opts = zp.zoneOptions(data, 'bike', liveAtL1, 'any')
    expect(zp.pickerHeight(opts)).toBe(
      2 * zp.PICKER_PAD + 3 * zp.PICKER_ROW_H + 4 * (zp.PICKER_GREY_ROW_H + 2),
    )
  })

  it('failure reasons map to the plan.md §5 tooltip strings', () => {
    expect(zp.failText('trucks-only')).toBe('Trucks only')
    expect(zp.failText('insufficient-funds')).toBe('Not enough money')
    expect(zp.failText('last-vehicle')).toBe('Keep at least one vehicle')
    expect(zp.failText('invalid')).toBe('Not possible right now')
  })
})
