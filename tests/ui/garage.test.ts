// city-view.md §7 (Garage sheet: geometry, rows, buy cards, footer), §6.2
// (ZonePicker), spec §4.1 (sell refund 50 %, last vehicle unsellable, home
// zones, Industrial trucks only), §4.6 (state text), §7.3-§7.4 (payday,
// salaries, re-hire fee). Pure helpers only; Phaser is stubbed because the
// modules import the Button kit (Phaser cannot load under Node).
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
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { dataFixture, makeSim } = await import('../sim/helpers.ts')

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
  it('sheet height is max(320, round(H × 0.6))', () => {
    expect(garage.garageSheetHeight(500)).toBe(320)
    expect(garage.garageSheetHeight(659)).toBe(395)
    expect(garage.garageSheetHeight(932)).toBe(559)
  })

  it('the fleet list sits between the 56-px header and the buy block, above the safe area', () => {
    expect(garage.garageListHeight(659, 0)).toBe(395 - 56 - 120)
    expect(garage.garageListHeight(932, 34)).toBe(559 - 56 - 120 - 34)
    expect(garage.garageListHeight(500, 200)).toBe(garage.ROW_PITCH)
  })

  it('three buy cards with 8-px gaps fit inside W − 24 at every target width', () => {
    for (const W of [360, 393, 430]) {
      const w = garage.cardWidth(W)
      expect(3 * w + 2 * garage.CARD_GAP).toBeLessThanOrEqual(W - 24)
      expect(w).toBeGreaterThanOrEqual(100)
    }
  })

  it('row columns (name, status, zone chip, Sell) never overlap from W 360 to 430', () => {
    for (const W of [360, 393, 430]) {
      const c = garage.rowColumns(W)
      expect(c.nameX + c.nameW).toBeLessThanOrEqual(c.statusX)
      expect(c.statusX + c.statusW).toBeLessThanOrEqual(c.zoneX)
      expect(c.zoneX + garage.ZONE_W).toBeLessThanOrEqual(c.sellX)
      expect(c.sellX + garage.SELL_W).toBeLessThanOrEqual(W - 12)
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

  it('the last vehicle cannot be sold: Sell disabled with "Keep at least one vehicle"', () => {
    const one = garage.rowAction(snap(), data, 1, false)
    expect(one).toEqual({
      kind: 'sell',
      label: 'Sell $100',
      enabled: false,
      tip: 'Keep at least one vehicle',
    })
    const two = garage.rowAction(snap(), data, 2, false)
    expect(two.enabled).toBe(true)
    expect(two.tip).toBeNull()
  })

  it('an inactive row offers Re-hire for one day of salary, enabled only once payroll ships', () => {
    const v = snap({ type: 'van', state: 'inactive', driverName: null })
    expect(garage.rehireCost(data, 'van')).toBe(15)
    expect(garage.rowAction(v, data, 3, false)).toMatchObject({
      kind: 'rehire',
      label: 'Re-hire $15',
      enabled: false,
    })
    expect(garage.rowAction(v, data, 3, true).enabled).toBe(true)
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

  it('driver line: "Dee · $8/day", red "! unpaid" after a short payday, "No driver" after a walkout', () => {
    expect(garage.driverLine(snap(), data)).toEqual({
      text: 'Dee · $8/day',
      red: false,
    })
    expect(garage.driverLine(snap({ unpaid: true }), data)).toEqual({
      text: 'Dee · ! unpaid',
      red: true,
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

  it('the longest Sell / Re-hire and zone-chip labels keep Button.CONTENT_PAD of air in m5x7 (UX M3: `Re-hire $25` touched its 64-px face)', async () => {
    const { readFileSync } = await import('node:fs')
    const xml = readFileSync(
      new URL('../../public/assets/m5x7.xml', import.meta.url),
      'utf8',
    )
    const adv = new Map<number, number>()
    for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
      adv.set(Number(m[1]), Number(m[2]))
    const width = (s: string): number =>
      [...s].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 6), 0)
    const { CONTENT_PAD } = await import('../../src/ui/Button.ts')
    const actions = data.vehicles.types.flatMap((t) => [
      garage.rowAction(
        { state: 'inactive', type: t.id, driverName: null },
        data,
        3,
        true,
      ).label,
      garage.rowAction({ state: 'idle_lot', type: t.id }, data, 3, true).label,
    ])
    for (const label of actions)
      expect(width(label), label).toBeLessThanOrEqual(
        garage.SELL_W - 2 * CONTENT_PAD,
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
    expect(garage.boughtToast('Bike 2', null)).toBe('Bike 2 bought')
    expect(garage.sellPrompt('Bike 2', 100)).toBe(
      'Sell Bike 2 for $100? Its parcels return to the shelf.',
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

describe('Garage rows against a live sim (spec §7.1, §4.1)', () => {
  it('a new game has no vehicle (empty state) and the first bike reads Idle, Dee · $8/day, Any ▾, Sell disabled', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    expect(vs.vehicles).toHaveLength(0)
    const res = vs.buyVehicle('bike')
    expect(res.ok).toBe(true)
    const [v] = vs.vehicles
    expect(v).toBeDefined()
    if (!v) return
    expect(v.name).toBe('Bike 1')
    expect(garage.stateText(v)).toBe('Idle')
    expect(garage.driverLine(v, vs.data).text).toBe(`${v.driverName} · $8/day`)
    expect(zp.zoneChipText(vs.data, vs.map, v.zone)).toBe('Any ▾')
    expect(
      garage.rowAction(v, vs.data, vs.vehicles.length, false).enabled,
    ).toBe(false)
    expect(garage.unitsText(v)).toBe('0/4')
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
