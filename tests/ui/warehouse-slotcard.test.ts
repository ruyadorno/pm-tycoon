// warehouse-view.md §2.2 (SlotCard: machine stats + "Lane vs metal: 97%",
// desk "Inspectors 2/3", Fire / Re-hire, "Sell for $75 (50%)", "Remove desk
// — N inspectors walk out, no refund"), §2.5 (the confirm names who walks
// out), spec §6.3 (D(metal) = 0.97 for inspector + Metal detector), §7.3-
// §7.4 (payday, re-hire = one day's salary); design-m6 §6.2 (M6 people: the
// desk line "catch 88% avg · false-flag 14% · 45/min", per-inspector rows
// with each effective p, "Salaries $44/day · Payday in 0:23", "Re-hire $24",
// Hire inspector without a price — full / seat held only, "Inspection desk
// 2"). Pure helpers + a headless Sim; Phaser is stubbed.
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
const { dataFixture, fund, hireInspector, makeSim, openingA } =
  await import('../sim/helpers.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { laneNode } = await import('../../src/sim/types.ts')
const payroll = await import('../../src/sim/systems/payroll.ts')

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

describe('design-m6 §6.2 desk stats (readout mean + Σ rate)', () => {
  it('Audrey alone: "catch 85% · false-flag 15% · 15/min"', () => {
    const sim = makeSim(1)
    const n = laneNode(sim.state.lane, 'slot1')
    const f = n?.fixture
    if (!n || f?.kind !== 'desk') throw new Error('desk')
    expect(sc.fixtureName(data, f.checker)).toBe('Inspection desk')
    const rate = sc.deskRatePerMin(n.stations, f.checker.processTicks)
    expect(rate).toBeCloseTo(15, 10)
    expect(
      sc.deskStatsLine(f.checker.pMatch, f.checker.decoyFlag, rate, 1),
    ).toBe('catch 85% · false-flag 15% · 15/min')
  })

  it('three seated: the mean p reads "avg" and the rate is Σ stations (3 × 4 s = 45/min)', () => {
    const sim = fund(makeSim(1))
    expect(hireInspector(sim).ok).toBe(true)
    expect(hireInspector(sim).ok).toBe(true)
    const n = laneNode(sim.state.lane, 'slot1')
    const f = n?.fixture
    if (!n || f?.kind !== 'desk') throw new Error('desk')
    const rate = sc.deskRatePerMin(n.stations, f.checker.processTicks)
    expect(rate).toBeCloseTo(45, 10)
    expect(
      sc.deskStatsLine(f.checker.pMatch, f.checker.decoyFlag, rate, 3),
    ).toBe('catch 85% avg · false-flag 15% · 45/min')
  })

  it('each inspector keeps its own pace: 3.0 s + 5.0 s = 20 + 12 = 32/min', () => {
    expect(
      sc.deskRatePerMin([{ processTicks: 30 }, { processTicks: 50 }], 40),
    ).toBeCloseTo(32, 10)
    // a station without its own number falls back to the desk readout
    expect(sc.deskRatePerMin([{}], 40)).toBeCloseTo(15, 10)
    expect(sc.deskStatsLine(0.8767, 0.15, 45, 3)).toBe(
      'catch 88% avg · false-flag 15% · 45/min',
    )
  })

  it('an empty desk reads 0 and the inspectors line says parcels pass unchecked', () => {
    expect(sc.deskStatsLine(0.85, 0.15, 0, 0)).toBe('catch 0% · 0/min')
    expect(sc.inspectorsLine(2, 3)).toBe('Inspectors 2/3')
    expect(sc.inspectorsLine(0, 3)).toBe(
      'Inspectors 0/3 — parcels pass unchecked',
    )
  })

  it('the card header names the desk by its desks.rows index', () => {
    expect(bs.deskTitle(1)).toBe('Inspection desk')
    expect(bs.deskTitle(2)).toBe('Inspection desk 2')
  })
})

describe('design-m6 §6.2 person rows', () => {
  it('rows come from ViewSim.people(): seated in seat order, then the walked-out holding a seat', () => {
    const sim = fund(makeSim(1))
    hireInspector(sim, { eye: 4, pace: 3, charisma: 2 })
    hireInspector(sim)
    const f = laneNode(sim.state.lane, 'slot1')?.fixture
    if (f?.kind !== 'desk') throw new Error('desk')
    const vs = createViewSim(sim)
    const rows = sc.deskPersonRows(f, vs.people())
    expect(rows.map((r) => [r.person.name, r.seated])).toEqual([
      ['Audrey', true],
      [rows[1]?.person.name, true],
      [rows[2]?.person.name, true],
    ])
    // the charisma-2 colleague lifts the others' p by 0.04 (B2 §2.3)
    expect(rows.map((r) => sc.pEffText(r.person))).toEqual([
      '89%',
      '90%',
      '89%',
    ])
    expect(sc.deskSalaryTotal(rows)).toBe(20 + 30 + 20)
    // a walkout keeps the seat and drops out of the salary line
    payroll.walkOut(sim, sim.state.employees[2]!)
    const after = sc.deskPersonRows(f, createViewSim(sim).people())
    expect(after.map((r) => r.seated)).toEqual([true, true, false])
    expect(sc.deskSalaryTotal(after)).toBe(20 + 30)
  })

  it('plan-build2 §8.3 acceptance (charisma): two 3-eye inspectors + a charisma-2 colleague read 89% / 89% / 85%, the desk line the mean', () => {
    const sim = fund(makeSim(1))
    hireInspector(sim) // 3/3/0
    hireInspector(sim, { eye: 3, pace: 3, charisma: 2 }) // the leader
    const n = laneNode(sim.state.lane, 'slot1')
    const f = n?.fixture
    if (!n || f?.kind !== 'desk') throw new Error('desk')
    const rows = sc.deskPersonRows(f, createViewSim(sim).people())
    expect(rows.map((r) => sc.pEffText(r.person))).toEqual([
      '89%',
      '89%',
      '85%',
    ])
    expect(f.checker.pMatch).toBeCloseTo(0.8767, 4)
    const rate = sc.deskRatePerMin(n.stations, f.checker.processTicks)
    expect(
      sc.deskStatsLine(f.checker.pMatch, f.checker.decoyFlag, rate, 3),
    ).toBe('catch 88% avg · false-flag 15% · 45/min')
  })

  it('compact pips: eye pace charisma = ●●●○○ ●●●○○ ●○ (92 px at a 7-px pitch)', () => {
    const g = bs.pipGroups(data, 'inspector', { eye: 3, pace: 3, charisma: 1 })
    expect(g).toEqual([
      [true, true, true, false, false],
      [true, true, true, false, false],
      [true, false],
    ])
    expect(bs.pipGroupsWidth(g)).toBe(35 + 4 + 35 + 4 + 14)
    expect(bs.pipDots(9, 5)).toEqual([true, true, true, true, true])
    expect(bs.pipDots(0, 2)).toEqual([false, false])
  })

  it('a row fits at 360: face, name, pips, pEff and "! unpaid" end left of [Fire]', () => {
    const fireX = 360 - bs.PAD - sc.FIRE_W
    expect(sc.NAME_X).toBeGreaterThanOrEqual(sc.FACE_X + sc.FACE_SIZE)
    expect(sc.PIPS_X).toBeGreaterThanOrEqual(sc.NAME_X + sc.NAME_W)
    expect(sc.PEFF_X).toBeGreaterThan(sc.PIPS_X + 92)
    // "! unpaid" is 8 glyphs of ≤ 6 px
    expect(sc.UNPAID_X + 8 * 6).toBeLessThan(fireX)
    // walked out: Re-hire + Fire right-aligned, clear of "Audrey 2 walked out"
    const rehireX = fireX - sc.ROW_BTN_GAP - sc.REHIRE_W
    expect(sc.NAME_X + 19 * 6).toBeLessThan(rehireX)
  })

  it('faces come from the sim look (face_00..face_11)', () => {
    expect(bs.faceFrame(0)).toBe('face_00')
    expect(bs.faceFrame(11)).toBe('face_11')
    expect(bs.faceFrame(99)).toBeNull()
  })
})

describe('§7.3-§7.4 salaries, Hire, Re-hire', () => {
  it('the salary line sums the real salaries', () => {
    expect(sc.salaryLine(44, 230)).toBe('Salaries $44/day · Payday in 0:23')
    const vs = createViewSim(makeSim(1))
    expect(sc.salaryLine(20, vs.ticksToPayday)).toBe(
      'Salaries $20/day · Payday in 1:00',
    )
  })

  it('Hire inspector has no price; it is refused only when the desk is full or a seat is held', () => {
    const max = data.employees.desks.maxPerDesk
    expect(sc.HIRE_INSPECTOR).toBe('Hire inspector')
    expect(sc.HIRE_INSPECTOR_TITLE).toBe('Hire an inspector')
    expect(sc.hireBlockReason(1, max)).toBeNull()
    expect(sc.hireBlockReason(3, max)).toBe('Desk full')
    expect(sc.hireBlockReason(2, max, 1)).toBe(sc.SEAT_HELD_TEXT)
  })

  it('§7.4 re-hire costs one day of the worker’s own salary: "Re-hire $24"', () => {
    expect(sc.rehireFee(data, 24)).toBe(24 * data.employees.rehireFeeDays)
    expect(sc.rehireLabel(24)).toBe('Re-hire $24')
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
    // M6 review: walked-out inspectors holding a seat are let go too.
    expect(sc.removeDeskLine(0)).toBe('Remove desk — no refund')
    expect(sc.removeDeskLine(0, 1)).toBe(
      'Remove desk — 1 inspector let go, no refund',
    )
    expect(sc.removeDeskLine(1, 1)).toBe(
      'Remove desk — 2 inspectors let go, no refund',
    )
    expect(sc.removeDeskPrompt([])).toBe('The empty desk is removed.')
    expect(sc.removeDeskPrompt([], ['Lin'])).toBe(
      'Lin (walked out) is let go, no refund.',
    )
    expect(sc.removeDeskPrompt(['Audrey'], ['Lin', 'Sem'])).toBe(
      'Audrey walks out and Lin and Sem (walked out) are let go, no refund.',
    )
    expect(sc.joinNames(['Audrey', 'Lin', 'Sem'])).toBe('Audrey, Lin and Sem')
  })
})

describe('§2 card geometry', () => {
  it('a full desk card (3 rows) and the machine card fit at 360 × 604', () => {
    const L = computeLayout(360, 604, 0, 0, 1)
    const bottom = bs.sheetBottom(L)
    const rows = data.employees.desks.maxPerDesk
    expect(bottom - sc.deskCardHeight(rows)).toBeGreaterThanOrEqual(HUD_TOP_H)
    expect(bottom - sc.MACHINE_CARD_H).toBeGreaterThanOrEqual(HUD_TOP_H)
  })

  it('person rows keep 44-px hit boxes', () => {
    expect(sc.PERSON_ROW_H).toBeGreaterThanOrEqual(44)
    expect(sc.deskCardHeight(2) - sc.deskCardHeight(1)).toBe(sc.PERSON_ROW_H)
  })
})
