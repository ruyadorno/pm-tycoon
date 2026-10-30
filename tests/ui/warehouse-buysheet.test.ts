// warehouse-view.md §2.1 (BuySheet rows: unlocked first, catch line, speed,
// locked "Unlocks at Lv N" + " · coming soon" past playtestMaxLevel (Q34),
// height 40 + 56 × rows), §2.5 (rows dim when unaffordable), §2 (sheet
// anchored on the HUD bottom band; fits the 360 × 604 minimum viewport),
// plan.md §5 (failure reason strings); design-m6 §6.2 / spec-build2 §2.4
// (desk rows from employees.json desks.rows: "Inspection desk" free,
// "Second desk $400" locked below Lv 3, "Move desk (N) here" per placed
// desk, placeDesk(node, index)).
// Pure helpers only; Phaser is stubbed because the module imports the
// Button kit.
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => {
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

const bs = await import('../../src/ui/warehouse/BuySheet.ts')
const { computeLayout, HUD_TOP_H } = await import('../../src/ui/layout.ts')
const { dataFixture, fund, makeSim } = await import('../sim/helpers.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { frameOrNull } = await import('../../src/render/frames.ts')

const data = dataFixture()
const def = (id: string) => {
  const d = data.machines.checkers.find((c) => c.id === id)
  if (!d) throw new Error(id)
  return d
}

describe('§6.3 checker row text (catch %, false-flag %, speed)', () => {
  it('Metal detector: catch 80% metal · 15% other · false-flag 50%, 60/min', () => {
    expect(bs.catchLine(def('metal_detector'))).toBe(
      'catch 80% metal · 15% other · false-flag 50%',
    )
    expect(bs.perMinText(def('metal_detector').processS)).toBe('60/min')
  })

  it('generalists read "any strain" with one p (X-ray 70%, 30/min)', () => {
    expect(bs.catchLine(def('xray'))).toBe(
      'catch 70% any strain · false-flag 25%',
    )
    expect(bs.perMinText(def('xray').processS)).toBe('30/min')
  })

  it('percentages are integers (probabilities × 100, rounded)', () => {
    expect(bs.pctOf(0.85)).toBe('85%')
    expect(bs.pctOf(0.155)).toBe('16%')
    expect(bs.pctOf(0.97)).toBe('97%')
  })

  it('parallel stations multiply the rate (3 inspectors = 45/min)', () => {
    const s = data.employees.roles.inspector.processS[2] ?? 0
    expect(bs.perMinText(s)).toBe('15/min')
    expect(bs.perMinText(s, 3)).toBe('45/min')
    expect(bs.perMinText(0)).toBe('0/min')
  })
})

const desk1 = (inspectors = 1, meanP = 0.85) => ({
  index: 1,
  nodeId: 'slot1',
  label: 'Slot 1',
  inspectors,
  meanP,
})

describe('§2.1 BuySheet rows: unlocked first, desk rows, locked last', () => {
  it('L1 with no desk: metal detector, the desk, then the locked rows by level', () => {
    const rows = bs.buyRows(data, 1, [])
    expect(rows.map((r) => r.id)).toEqual([
      'metal_detector',
      'desk',
      'shaky_shaker',
      'battery_checker',
      'desk2',
      'xray',
    ])
    expect(rows.map((r) => r.locked)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
    ])
    expect(bs.buySheetHeight(rows.length)).toBe(40 + 56 * 6)
  })

  it('L2 unlocks the Shaky shaker row ahead of the desk', () => {
    const ids = bs.buyRows(data, 2, []).map((r) => r.id)
    expect(ids).toEqual([
      'metal_detector',
      'shaky_shaker',
      'desk',
      'battery_checker',
      'desk2',
      'xray',
    ])
  })

  it('every row is built from machines.json (name, price, lines)', () => {
    const md = bs.buyRows(data, 1, [])[0]
    expect(md).toMatchObject({
      kind: 'machine',
      name: 'Metal detector',
      price: def('metal_detector').price,
      priceText: '$150',
      lines: ['catch 80% metal · 15% other · false-flag 50%', '60/min'],
    })
  })

  it('Q34: locked rows read "Unlocks at Lv N", + " · coming soon" past playtestMaxLevel', () => {
    const rows = bs.buyRows(data, 1, [])
    const line = (id: string) => rows.find((r) => r.id === id)?.lines[1]
    expect(data.economy.playtestMaxLevel).toBe(2)
    expect(line('shaky_shaker')).toBe('60/min · Unlocks at Lv 2')
    expect(line('battery_checker')).toBe(
      '60/min · Unlocks at Lv 3 · coming soon',
    )
    expect(line('desk2')).toBe('Unlocks at Lv 3 · coming soon')
    expect(line('xray')).toBe('30/min · Unlocks at Lv 4 · coming soon')
    expect(bs.unlockText(data, 2)).toBe('Unlocks at Lv 2')
  })

  it('plan-build2 §8.2 task 11: the suffix vanishes by data once the cap rises', () => {
    const top = Math.max(...data.levels.map((l) => l.level))
    const open = dataFixture({ economy: { playtestMaxLevel: top } })
    expect(bs.unlockText(open, 3)).toBe('Unlocks at Lv 3')
    expect(bs.unlockText(open, top)).toBe(`Unlocks at Lv ${top}`)
  })

  it('the desk row: free, seats 1–3, hire from 3 applicants, catch 75–94% by eye, $12–36/day each', () => {
    const desk = bs.buyRows(data, 1, []).find((r) => r.id === 'desk')
    expect(desk).toMatchObject({
      kind: 'desk',
      index: 1,
      name: 'Inspection desk',
      price: 0,
      priceText: 'free',
      lines: [
        'seats 1–3 · hire from 3 applicants',
        'catch 75–94% by eye · $12–36/day each',
      ],
    })
  })

  it('B2 §2.4: the Second desk is $400, locked below Lv 3 and placeable from it', () => {
    const row = data.employees.desks.rows.find((r) => r.index === 2)
    expect(row).toMatchObject({ unlockLevel: 3, price: 400 })
    const l2 = bs.buyRows(data, 2, [desk1()]).find((r) => r.id === 'desk2')
    expect(l2).toMatchObject({
      kind: 'desk',
      index: 2,
      name: 'Second desk',
      priceText: '$400',
      locked: true,
    })
    expect(bs.rowState(l2!, 1_000_000)).toBe('locked')
    const l3 = bs.buyRows(data, 3, [desk1()])
    expect(l3.map((r) => r.id)).toEqual([
      'metal_detector',
      'shaky_shaker',
      'battery_checker',
      'desk',
      'desk2',
      'xray',
    ])
    const d2 = l3.find((r) => r.id === 'desk2')
    expect(d2?.locked).toBe(false)
    expect(d2?.lines[1]).toBe('catch 75–94% by eye · $12–36/day each')
    expect(bs.rowState(d2!, 399)).toBe('poor')
    expect(bs.rowState(d2!, 400)).toBe('ok')
  })

  it('a placed desk turns its row into "Move desk here" (numbered once two are placed)', () => {
    const rows = bs.buyRows(data, 1, [desk1()])
    expect(rows.filter((r) => r.kind === 'desk').map((r) => r.id)).toEqual([
      'desk2',
    ])
    const mv = rows.find((r) => r.kind === 'moveDesk')
    expect(mv).toMatchObject({
      id: 'desk',
      index: 1,
      name: 'Move desk here',
      priceText: 'free',
      lines: [
        'Inspection desk from Slot 1 · 1 inspector',
        'catch 85% · moves are free',
      ],
    })
    expect(rows.map((r) => r.id).indexOf('desk')).toBe(1)
    const two = bs.buyRows(data, 3, [
      desk1(3, 0.8767),
      {
        index: 2,
        nodeId: 'slot3',
        label: 'Slot 3',
        inspectors: 0,
        meanP: 0.85,
      },
    ])
    const moves = two.filter((r) => r.kind === 'moveDesk')
    expect(moves.map((r) => r.name)).toEqual([
      'Move desk 1 here',
      'Move desk 2 here',
    ])
    expect(moves.map((r) => r.lines)).toEqual([
      [
        'Inspection desk from Slot 1 · 3 inspectors',
        'catch 88% avg · moves are free',
      ],
      [
        'Inspection desk 2 from Slot 3 · 0 inspectors',
        'no inspectors · moves are free',
      ],
    ])
  })

  it('every combination of rows fits the 360 × 604 sheet (≤ 6 rows)', () => {
    const L = computeLayout(360, 604, 0, 0, 1)
    for (const level of [1, 2, 3, 4, 5])
      for (const placed of [[], [desk1()]]) {
        const n = bs.buyRows(data, level, placed).length
        expect(n).toBeLessThanOrEqual(6)
        expect(bs.sheetBottom(L) - bs.buySheetHeight(n)).toBeGreaterThanOrEqual(
          HUD_TOP_H,
        )
      }
  })
})

describe('design-m6 §6.2 desk 2 through the facade (placeDesk(node, index))', () => {
  it('desk-locked at L2, $400 at L3 (debug.forceLevel), a second placement is desk-exists', () => {
    const sim = fund(makeSim(1), 1000)
    const vs = createViewSim(sim, { debug: true })
    expect(vs.lane.placeDesk('slot2', 2)).toEqual({
      ok: false,
      reason: 'desk-locked',
    })
    expect(bs.warehouseFailText('desk-locked', data)).toBe(
      'Second desk opens at Lv 3',
    )
    expect(vs.debug?.forceLevel(3)).toEqual({ ok: true })
    const before = vs.money
    expect(vs.lane.placeDesk('slot2', 2)).toEqual({ ok: true })
    expect(vs.money).toBe(before - 400)
    expect(bs.deskNodeByIndex(vs.lane.nodes(), 2)?.id).toBe('slot2')
    expect(vs.lane.placeDesk('slot3', 2)).toEqual({
      ok: false,
      reason: 'desk-exists',
    })
    expect(bs.warehouseFailText('desk-exists')).toBe(
      'That desk is already placed',
    )
  })
})

describe('§2.5 row state follows the balance', () => {
  const rows = bs.buyRows(data, 1, [])
  const md = rows[0] as (typeof rows)[number]
  const shaker = rows.find((r) => r.id === 'shaky_shaker') as typeof md
  it('unaffordable rows are "poor" (red price, deny on tap)', () => {
    expect(bs.rowState(md, md.price - 1)).toBe('poor')
    expect(bs.rowState(md, md.price)).toBe('ok')
  })
  it('locked wins over price', () => {
    expect(bs.rowState(shaker, 1_000_000)).toBe('locked')
  })
})

describe('plan.md §5 failure reasons → tooltip text', () => {
  it('maps every lane reason to a player-facing line', () => {
    expect(bs.warehouseFailText('insufficient-funds')).toBe('Not enough money')
    expect(bs.warehouseFailText('slot-occupied')).toBe('Slot already taken')
    expect(bs.warehouseFailText('slot-locked')).toBe('Slot not open yet')
    expect(bs.warehouseFailText('desk-full')).toBe('Desk is full')
    expect(bs.warehouseFailText('desk-exists')).toBe(
      'That desk is already placed',
    )
    expect(bs.warehouseFailText('shelf-full')).toBe('Shelf full')
    expect(bs.warehouseFailText('locked')).toBe('Not available yet')
    // M6 people (design-m6 §6.3; level-gated texts read employees.json)
    expect(bs.warehouseFailText('no-applicant')).toBe(
      'That applicant took another job',
    )
    expect(bs.warehouseFailText('station-occupied')).toBe(
      'The station is taken',
    )
    expect(bs.warehouseFailText('station-locked', data)).toBe('Opens at Lv 2')
    expect(bs.warehouseFailText('desk-locked', data)).toBe(
      'Second desk opens at Lv 3',
    )
    // 'invalid' is a UI bug; it never shows the raw reason.
    expect(bs.warehouseFailText('invalid')).not.toContain('invalid')
  })
})

describe('§2 sheet geometry', () => {
  it('the sheet bottom is the top of the HUD bottom band', () => {
    const L = computeLayout(393, 659, 0, 0, 1)
    expect(bs.sheetBottom(L)).toBe(L.bottomBar.y)
    expect(bs.sheetBottom(L)).toBe(659 - 64)
    const Ls = computeLayout(393, 745, 20, 34, 1)
    expect(bs.sheetBottom(Ls)).toBe(745 - 34 - 64)
    expect(bs.sheetBottom({ W: 360, H: 604, minHit: 44 })).toBe(604 - 64)
  })

  it('the full BuySheet fits under the HUD top band at 360 × 604 and 393 × 659', () => {
    const rows = bs.buyRows(data, 2, []).length
    for (const [W, H] of [
      [360, 604],
      [393, 659],
    ] as const) {
      const L = computeLayout(W, H, 0, 0, 1)
      const top = bs.sheetBottom(L) - bs.buySheetHeight(rows)
      expect(top).toBeGreaterThanOrEqual(HUD_TOP_H)
    }
  })

  it('a row is a 52-px tap target on a 56-px pitch (≥ 44, no overlap)', () => {
    expect(bs.ROW_H).toBeGreaterThanOrEqual(44)
    expect(bs.ROW_PITCH).toBeGreaterThan(bs.ROW_H)
  })
})

describe('labels and frames', () => {
  it('without a room layout the node id is title-cased', () => {
    expect(bs.fallbackLabel('slot2')).toBe('Slot 2')
    expect(bs.fallbackLabel('hold')).toBe('Hold')
    expect(bs.fallbackLabel('dock1')).toBe('Dock 1')
  })

  it('machine icons come from the atlas (_f0, else _sil, else ic_lock)', () => {
    expect(bs.machineFrame('metal_detector')).toBe('metal_detector_f0')
    expect(bs.machineFrame('shaky_shaker')).toBe('shaky_shaker_f0')
    // the X-ray's own art may land before its level does (else its silhouette)
    expect(bs.machineFrame('xray')).toBe(frameOrNull('xray_f0') ?? 'xray_sil')
    expect(bs.machineFrame('nope')).toBe('ic_lock')
  })
})

describe('§8 the BuySheet opens on empty live slots only', () => {
  it('start state: slot1 holds the desk, slot2 is empty, slot4 locked', () => {
    const vs = createViewSim(makeSim(1))
    const node = (id: string) => bs.findNode(vs, id)
    expect(bs.isEmptyLiveSlot(node('slot1'))).toBe(false)
    expect(bs.isEmptyLiveSlot(node('slot2'))).toBe(true)
    expect(bs.isEmptyLiveSlot(node('slot4'))).toBe(false)
    expect(bs.isEmptyLiveSlot(node('shelf'))).toBe(false)
    expect(bs.isEmptyLiveSlot(null)).toBe(false)
    expect(bs.deskNode(vs.lane.nodes())?.id).toBe('slot1')
  })
})
