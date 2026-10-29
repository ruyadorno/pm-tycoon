// warehouse-view.md §2.2 (SlotCard: machine stats + "Lane vs metal: 97%",
// desk "Inspectors 2/3", "85% any strain · false-flag 15% · 30/min",
// "Salaries: 2 × $20 = $40/day · Payday in 0:23", Hire / Fire / Re-hire,
// "Sell for $75 (50%)", "Remove desk — N inspectors walk out, no refund"),
// §2.5 (the confirm names who walks out), spec §6.3 (D(metal) = 0.97 for
// inspector + Metal detector), §6.7 (hire fee, max 3), §7.3-§7.4 (payday,
// re-hire = one day's salary). Pure helpers; Phaser is stubbed.
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

const sc = await import('../../src/ui/warehouse/SlotCard.ts')
const bs = await import('../../src/ui/warehouse/BuySheet.ts')
const { computeLayout, HUD_TOP_H } = await import('../../src/ui/layout.ts')
const { dataFixture, makeSim, openingA } = await import('../sim/helpers.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { laneNode } = await import('../../src/sim/types.ts')

const data = dataFixture()

describe('§6.3 the lane line: Lane vs metal', () => {
  it('inspector + Metal detector = 1 − 0.15 × 0.20 = 0.97 → "Lane vs metal: 97%"', () => {
    const sim = makeSim(1)
    openingA(sim)
    const d = sc.laneRateFor(sim.state.lane.nodes, 'metal')
    expect(d).toBeCloseTo(0.97, 10)
    expect(sc.laneVsLine('metal', d)).toBe('Lane vs metal: 97%')
    // Same number as the facade's §6.3 readout.
    const vs = createViewSim(sim)
    const det = vs.lane.detection().find((x) => x.strain === 'metal')
    expect(det?.d).toBeCloseTo(d, 10)
  })

  it('the inspector alone is 0.85 against any strain', () => {
    const sim = makeSim(1)
    expect(sc.laneRateFor(sim.state.lane.nodes, 'metal')).toBeCloseTo(0.85)
    expect(sc.laneRateFor(sim.state.lane.nodes, 'rattle')).toBeCloseTo(0.85)
  })

  it('a desk with no inspector passes parcels through (D = 0)', () => {
    const sim = makeSim(1)
    const n = laneNode(sim.state.lane, 'slot1')
    if (!n) throw new Error('slot1')
    n.stations = []
    expect(sc.laneRateFor(sim.state.lane.nodes, 'metal')).toBe(0)
  })
})

describe('§2.2 machine stats', () => {
  it('Metal detector: strain + catch, false-flag + speed', () => {
    const sim = makeSim(1)
    openingA(sim)
    const n = sim.state.lane.nodes.find(
      (x) => x.fixture?.checker.defId === 'metal_detector',
    )
    const c = n?.fixture?.checker
    if (!c) throw new Error('no detector')
    expect(sc.strainCatchLine(c)).toBe('metal · catch 80% / 15% other')
    expect(sc.machineSpeedLine(c)).toBe('false-flag 50% · 60/min')
    expect(sc.fixtureName(data, c)).toBe('Metal detector')
  })

  it('generalists show one catch rate', () => {
    expect(
      sc.strainCatchLine({ strain: 'any', pMatch: 0.7, pOther: 0.7 }),
    ).toBe('any strain · catch 70%')
  })

  it('Q11: "Sell for $75 (50%)" from machines.json removalRefund', () => {
    const md = data.machines.checkers.find((c) => c.id === 'metal_detector')
    if (!md) throw new Error('md')
    const frac = data.machines.removalRefund
    expect(sc.sellLabel(md.price, frac)).toBe('Sell for $75 (50%)')
    expect(sc.sellPrompt(md.price, frac)).toBe('Refund $75 (50% of $150).')
    expect(sc.refundOf(125, 0.5)).toBe(63)
  })
})

describe('§2.2 / §6.7 desk stats', () => {
  it('85% any strain · false-flag 15% · 15/min per seated inspector', () => {
    const sim = makeSim(1)
    const f = laneNode(sim.state.lane, 'slot1')?.fixture
    if (!f) throw new Error('desk')
    expect(sc.fixtureName(data, f.checker)).toBe('Inspection desk')
    expect(sc.deskStatsLine(f.checker, 1)).toBe(
      '85% any strain · false-flag 15% · 15/min',
    )
    expect(sc.deskStatsLine(f.checker, 2)).toBe(
      '85% any strain · false-flag 15% · 30/min',
    )
  })

  it('"Inspectors 2/3"; an empty desk says parcels pass unchecked', () => {
    expect(sc.inspectorsLine(2, 3)).toBe('Inspectors 2/3')
    expect(sc.inspectorsLine(0, 3)).toBe(
      'Inspectors 0/3 — parcels pass unchecked',
    )
  })

  it('§7.3 salary line with the payday countdown', () => {
    expect(sc.salaryLine(2, 20, 230)).toBe(
      'Salaries: 2 × $20 = $40/day · Payday in 0:23',
    )
    const vs = createViewSim(makeSim(1))
    const i = data.employees.inspector
    expect(sc.salaryLine(1, i.salaryPerDay, vs.ticksToPayday)).toBe(
      'Salaries: 1 × $20 = $20/day · Payday in 1:00',
    )
  })

  it('§6.7 Hire inspector ($20): disabled at maxPerDesk or below the fee', () => {
    const i = data.employees.inspector
    expect(sc.hireLabel(i.hireFee)).toBe('Hire inspector ($20)')
    expect(sc.hireBlockReason(1, i.maxPerDesk, 450, i.hireFee)).toBeNull()
    expect(sc.hireBlockReason(3, i.maxPerDesk, 450, i.hireFee)).toBe(
      'Desk full',
    )
    expect(sc.hireBlockReason(1, i.maxPerDesk, i.hireFee - 1, i.hireFee)).toBe(
      'Not enough money',
    )
  })

  it('§7.4 re-hire costs one day of salary', () => {
    expect(sc.rehireFee(data)).toBe(20)
    expect(sc.rehireLabel('Lin', sc.rehireFee(data))).toBe('Re-hire Lin ($20)')
  })

  it('§6.2 removing the desk: inspectors walk out, no refund; the confirm names them', () => {
    expect(sc.removeDeskLine(2)).toBe(
      'Remove desk — 2 inspectors walk out, no refund',
    )
    expect(sc.removeDeskLine(1)).toBe(
      'Remove desk — 1 inspector walks out, no refund',
    )
    expect(sc.removeDeskPrompt(['Audrey', 'Lin'])).toBe(
      'Audrey and Lin walk out, no refund.',
    )
    expect(sc.removeDeskPrompt(['Audrey'])).toBe('Audrey walks out, no refund.')
    expect(sc.joinNames(['Audrey', 'Lin', 'Sem'])).toBe('Audrey, Lin and Sem')
  })
})

describe('§2 card geometry', () => {
  it('a full desk card (3 rows) and the machine card fit at 360 × 604', () => {
    const L = computeLayout(360, 604, 0, 0, 1)
    const bottom = bs.sheetBottom(L)
    const rows = data.employees.inspector.maxPerDesk
    expect(bottom - sc.deskCardHeight(rows)).toBeGreaterThanOrEqual(HUD_TOP_H)
    expect(bottom - sc.MACHINE_CARD_H).toBeGreaterThanOrEqual(HUD_TOP_H)
  })

  it('person rows keep 44-px hit boxes', () => {
    expect(sc.PERSON_ROW_H).toBeGreaterThanOrEqual(44)
    expect(sc.deskCardHeight(2) - sc.deskCardHeight(1)).toBe(sc.PERSON_ROW_H)
  })
})
