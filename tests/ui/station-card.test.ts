// design-m6 §6.2 StationCard (spec-build2 §2.6; plan-build2 §8.3 task 5):
// the Hold Bay station's states — locked (`Hold Bay station · Unlocks at
// Lv 2`, a tooltip), empty (the pitch + Hire a sorter + Buy Sorter Arm $600
// with its `Lv 4` gate), on duty (`judgement 85% · one call / 6 s ·
// $28/day`, Replace / Fire), walked out (Re-hire $28 / Fire), the Sorter
// Arm (`Sorter Arm · tosses every held parcel after 3 s`, Remove +$300) —
// the on-duty rows carry the B2 §2.6 tooltip `Pat · judgement 85% · one
// call / 6 s · $28/day` — and the card height (≤ 220). Pure helpers + a headless Sim
// driving the same facade calls the card makes; Phaser is stubbed.
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

const st = await import('../../src/ui/warehouse/StationCard.ts')
const bs = await import('../../src/ui/warehouse/BuySheet.ts')
const sc = await import('../../src/ui/warehouse/SlotCard.ts')
const { computeLayout, HUD_TOP_H } = await import('../../src/ui/layout.ts')
const { dataFixture, fund, makeSim, standardApplicant } =
  await import('../sim/helpers.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const payroll = await import('../../src/sim/systems/payroll.ts')

const data = dataFixture()
type TestSim = ReturnType<typeof makeSim>

/** The card's Hire a sorter → HireSheet → vs.hire(…, {station: 'hold'}). */
function hireSorter(sim: TestSim, pips = { judgement: 3, pace: 3 }) {
  const a = standardApplicant(sim, 'sorter', pips)
  const vs = createViewSim(sim)
  const res = vs.hire('sorter', a.id, { station: 'hold' })
  if (!res.ok) throw new Error(`hire sorter: ${res.reason}`)
  return { a, id: res.employeeId as number }
}

describe('the station states (B2 §2.6)', () => {
  it('locked at L1: the tooltip line, and the card refuses to open', () => {
    const vs = createViewSim(makeSim(1))
    const hs = vs.holdStation
    expect(hs.unlocked).toBe(false)
    expect(st.stationState(hs)).toBe('locked')
    expect(st.stationLockedLine(data, hs.unlockLevel)).toBe(
      'Hold Bay station · Unlocks at Lv 2',
    )
    expect(st.stationModel(data, hs).lines[0]).toBe(
      'Hold Bay station · Unlocks at Lv 2',
    )
  })

  it('empty at L2: the pitch, Hire a sorter and Buy Sorter Arm $600 (Lv 4)', () => {
    const sim = fund(makeSim(1))
    const vs = createViewSim(sim, { debug: true })
    expect(vs.debug?.forceLevel(2)).toEqual({ ok: true })
    const m = st.stationModel(data, vs.holdStation)
    expect(m).toMatchObject({
      state: 'empty',
      title: 'Hold Bay station',
      lines: [
        'A sorter tosses wanted labels and obvious malware. Only you Clear.',
      ],
      buttons: ['Hire a sorter', 'Buy Sorter Arm $600'],
    })
    const arm = st.armDef(data)!
    expect(st.armCaption(arm, 2, 1_000_000)).toBe('Lv 4')
    expect(st.armBlockReason(data, arm, 2, 1_000_000)).toBe(
      'Unlocks at Lv 4 · coming soon',
    )
    // the card's buyArm refuses below the level (locked) — the button is disabled
    expect(vs.lane.buyMachine('sorter_arm', bs.holdNodeId(vs))).toEqual({
      ok: false,
      reason: 'locked',
    })
  })

  it('on duty: the name row + "judgement 85% · one call / 6 s · $28/day" (B2 §2.6 tooltip content), Replace / Fire', () => {
    const sim = fund(makeSim(1))
    sim.dispatch({ kind: 'debugForceLevel', level: 2 })
    const { a } = hireSorter(sim)
    const vs = createViewSim(sim)
    const hs = vs.holdStation
    expect(st.stationState(hs)).toBe('onDuty')
    const p = hs.sorter!
    expect(st.sorterStatsLine(p.numbers, p.salaryPerDay)).toBe(
      'judgement 85% · one call / 6 s · $28/day',
    )
    expect(st.stationModel(data, hs)).toMatchObject({
      status: 'Sorter on duty',
      lines: [a.name, 'judgement 85% · one call / 6 s · $28/day'],
      buttons: ['Replace', 'Fire'],
    })
    // compact pips: judgement, pace
    expect(bs.pipGroups(data, 'sorter', p.pips)).toEqual([
      [true, true, true, false, false],
      [true, true, true, false, false],
    ])
  })

  it('Replace = hire into the seated station: the old sorter is fired (D11)', () => {
    const sim = fund(makeSim(1))
    sim.dispatch({ kind: 'debugForceLevel', level: 2 })
    const first = hireSorter(sim)
    const second = hireSorter(sim, { judgement: 5, pace: 5 })
    const vs = createViewSim(sim)
    expect(vs.holdStation.sorter?.id).toBe(second.id)
    expect(vs.people().some((x) => x.id === first.id)).toBe(false)
    expect(
      st.sorterStatsLine(
        vs.holdStation.sorter!.numbers,
        vs.holdStation.sorter!.salaryPerDay,
      ),
    ).toBe('judgement 95% · one call / 4 s · $40/day')
  })

  it('walked out: the seat is held; Re-hire $28 and Fire', () => {
    const sim = fund(makeSim(1))
    sim.dispatch({ kind: 'debugForceLevel', level: 2 })
    const { a, id } = hireSorter(sim)
    payroll.walkOut(
      sim,
      sim.state.employees.find((e) => e.id === id)!,
    )
    const vs = createViewSim(sim)
    expect(st.stationState(vs.holdStation)).toBe('walkedOut')
    expect(st.stationModel(data, vs.holdStation)).toMatchObject({
      lines: [
        `${a.name} walked out`,
        'judgement 85% · one call / 6 s · $28/day',
      ],
      buttons: ['Re-hire $28', 'Fire'],
    })
    expect(vs.lane.rehire(id)).toEqual({ ok: true })
    expect(st.stationState(vs.holdStation)).toBe('onDuty')
    expect(vs.fire(id)).toEqual({ ok: true })
    expect(st.stationState(vs.holdStation)).toBe('empty')
  })

  it('the Sorter Arm (L4): bought into the station, "tosses every held parcel after 3 s", Remove +$300 refunds half', () => {
    const sim = fund(makeSim(1))
    const vs = createViewSim(sim, { debug: true })
    expect(vs.debug?.forceLevel(4)).toEqual({ ok: true })
    const arm = st.armDef(data)!
    expect(st.armCaption(arm, 4, arm.price - 1)).toBe('Not enough money')
    expect(st.armCaption(arm, 4, arm.price)).toBeNull()
    const before = vs.money
    expect(vs.lane.buyMachine('sorter_arm', bs.holdNodeId(vs))).toEqual({
      ok: true,
    })
    expect(vs.money).toBe(before - 600)
    expect(st.stationState(vs.holdStation)).toBe('arm')
    expect(st.stationModel(data, vs.holdStation)).toMatchObject({
      status: 'Sorter Arm',
      lines: [
        'Sorter Arm · tosses every held parcel after 3 s',
        'Clear a parcel first to keep it',
      ],
      buttons: ['Remove +$300'],
    })
    // never both: a sorter hire is refused while the Arm sits
    const a = standardApplicant(sim, 'sorter')
    expect(vs.hire('sorter', a.id, { station: 'hold' })).toEqual({
      ok: false,
      reason: 'station-occupied',
    })
    expect(bs.warehouseFailText('station-occupied')).toBe(
      'The station is taken',
    )
    const mid = vs.money
    expect(vs.lane.removeFixture(bs.holdNodeId(vs))).toEqual({ ok: true })
    expect(vs.money).toBe(mid + 300)
    expect(st.stationState(vs.holdStation)).toBe('empty')
  })
})

describe('text helpers', () => {
  it('seconds read "6 s" (one decimal only when needed)', () => {
    expect(st.secondsText(6)).toBe('6 s')
    expect(st.secondsText(4.5)).toBe('4.5 s')
    expect(st.secondsText(3)).toBe('3 s')
  })

  it('Arm labels come from machines.json upgrades', () => {
    const arm = st.armDef(data)!
    expect(st.armBuyLabel(arm)).toBe('Buy Sorter Arm $600')
    expect(st.armRemoveLabel(arm, data.machines.removalRefund)).toBe(
      'Remove +$300',
    )
    expect(st.armLine(arm)).toBe(
      'Sorter Arm · tosses every held parcel after 3 s',
    )
  })
})

describe('card geometry', () => {
  it('every state is ≤ 220 px and fits under the HUD top band at 360 × 604', () => {
    const L = computeLayout(360, 604, 0, 0, 1)
    for (const s of [
      'empty',
      'onDuty',
      'walkedOut',
      'arm',
      'locked',
    ] as const) {
      const h = st.stationCardHeight(s)
      expect(h, s).toBeLessThanOrEqual(st.STATION_CARD_MAX_H)
      expect(bs.sheetBottom(L) - h).toBeGreaterThanOrEqual(HUD_TOP_H)
    }
  })

  it('the sorter row: name, pips (74 px) and "! unpaid" end before the right edge at 360', () => {
    const pipsEnd =
      sc.PIPS_X +
      bs.pipGroupsWidth(bs.pipGroups(data, 'sorter', { judgement: 1, pace: 1 }))
    expect(pipsEnd).toBe(sc.PIPS_X + 74)
    expect(st.UNPAID_X).toBeGreaterThan(pipsEnd)
    expect(st.UNPAID_X + 8 * 6).toBeLessThan(360 - bs.PAD)
  })
})
