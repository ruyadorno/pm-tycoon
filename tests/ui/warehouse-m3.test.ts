// Warehouse M3 (plan.md §12.6 task 6; warehouse-view.md §1.6, §1.12, §2.2,
// §3.1, §5; spec §5.4, §6.2, §7.4, §8): the L2 lane (slot 4 live, the Shaky
// shaker row, rattle in the readout), the tier-2 look, stable Hold Bay bays,
// the payroll rows of the desk card (re-hire, the seat held for a walked-out
// inspector) and CLEAR's green face. Pure helpers + a headless Sim; Phaser is
// stubbed.
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

const lr = await import('../../src/render/warehouse/LaneRenderer.ts')
const bs = await import('../../src/ui/warehouse/BuySheet.ts')
const sc = await import('../../src/ui/warehouse/SlotCard.ts')
const hb = await import('../../src/ui/warehouse/HoldBayCard.ts')
const { strainRows } = await import('../../src/ui/ShieldPopover.ts')
const { FRAMES } = await import('../../src/render/frames.generated.ts')
const { dataFixture, hireInspector, makeSim } =
  await import('../sim/helpers.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { laneNode } = await import('../../src/sim/types.ts')
const payroll = await import('../../src/sim/systems/payroll.ts')

const data = dataFixture()
type TestSim = ReturnType<typeof makeSim>

/** Cross the L2 threshold (levels.json) and run the level-up tick. */
function toLevel2(sim: TestSim): void {
  const row = sim.data.levels.find((l) => l.level === 2)
  if (!row) throw new Error('levels.json has no L2 row')
  sim.state.economy.lifetimeEarned = row.threshold
  sim.tick()
  if (sim.state.level.level !== 2) throw new Error('no level-up')
}

function desk(sim: TestSim) {
  const n = sim.state.lane.nodes.find((x) => x.fixture?.kind === 'desk')
  if (!n || n.fixture?.kind !== 'desk') throw new Error('no desk')
  return { node: n, f: n.fixture }
}

describe('§6.2 / §1.6 slot 4 unrolls at L2', () => {
  it('slot 4 is locked at L1 and an empty live slot (BuySheet target) at L2', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    expect(bs.findNode(vs, 'slot4')?.locked?.level).toBe(2)
    expect(bs.isEmptyLiveSlot(bs.findNode(vs, 'slot4'))).toBe(false)
    toLevel2(sim)
    expect(bs.findNode(vs, 'slot4')?.locked).toBeUndefined()
    expect(bs.isEmptyLiveSlot(bs.findNode(vs, 'slot4'))).toBe(true)
  })

  it('§5.3 the tier cross-fade is 400 ms; §1.6 the unroll steps its belt tiles 75 ms apart', () => {
    expect(lr.TIER_FADE_MS).toBe(400)
    expect(lr.UNROLL_STEP_MS).toBe(75)
  })
})

describe('§8 L2 unlocks the Shaky shaker (data-driven BuySheet row)', () => {
  it('the row is locked at L1 and the facade refuses it; at L2 the row opens and the facade buys it into slot 4', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    sim.state.economy.balance = 1000
    const l1 = bs.buyRows(data, 1, []).find((r) => r.id === 'shaky_shaker')
    expect(l1?.locked).toBe(true)
    expect(vs.lane.buyMachine('shaky_shaker', 'slot2')).toEqual({
      ok: false,
      reason: 'locked',
    })
    toLevel2(sim)
    const l2 = bs
      .buyRows(data, vs.level, [])
      .find((r) => r.id === 'shaky_shaker')
    expect(l2?.locked).toBe(false)
    expect(bs.rowState(l2!, vs.money)).toBe('ok')
    expect(vs.lane.buyMachine('shaky_shaker', 'slot4')).toEqual({ ok: true })
    expect(laneNode(sim.state.lane, 'slot4')?.fixture?.checker.defId).toBe(
      'shaky_shaker',
    )
  })
})

describe('§5.4 the rattle strain joins the readout once announced (L2)', () => {
  it('the readout popover lists metal only at L1, metal + rattle after the level-up', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    expect(strainRows(vs.laneStats(), data).map((r) => r.strain)).toEqual([
      'metal',
    ])
    toLevel2(sim)
    const rows = strainRows(vs.laneStats(), data)
    expect(rows.map((r) => r.strain).toSorted()).toEqual(['metal', 'rattle'])
    // The desk alone: 85% against both; the readout mean is the same.
    expect(vs.laneStats().detectionPct).toBe(85)
  })
})

describe('§5.2 tier 2 at L2', () => {
  it('the visual tier follows levels.json warehouseTier (capped at the t2 art)', () => {
    expect(lr.visualTier(data, 1)).toBe(1)
    expect(lr.visualTier(data, 2)).toBe(2)
    expect(lr.visualTier(data, 5)).toBe(2)
  })

  it('every tier-keyed frame exists for both tiers', () => {
    const frames = FRAMES as Record<string, string>
    for (const t of [1, 2]) {
      for (const stem of ['wall', 'wallface', 'sign', 'shelf', 'wanted_poster'])
        expect(frames[`${stem}_t${t}`], `${stem}_t${t}`).toBeDefined()
    }
    for (const f of [
      'floor_t1_0',
      'floor_t2',
      'floor_t2_lane',
      'bulb_0',
      'strip_light',
      'props_t1',
      'props_t2',
      'ui_tag',
    ])
      expect(frames[f], f).toBeDefined()
  })
})

describe('M3 stable Hold Bay bays (no compaction under the finger)', () => {
  it('a Toss leaves the other held parcels on their bays; the next arrival takes the lowest free bay', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    expect(sim.dispatch({ kind: 'debugFillHoldBay' })).toEqual({ ok: true })
    const before = vs.holdBay.items.map((i) => [i.parcelId, i.bay])
    expect(before.map(([, b]) => b)).toEqual([0, 1, 2])
    const first = vs.holdBay.items.find((i) => i.bay === 0)!.parcelId
    expect(vs.holdBay.toss(first)).toEqual({ ok: true })
    const hold = laneNode(sim.state.lane, sim.state.lane.holdBayNodeId)!
    const pos = lr.holdBayPositions(hold.queue, vs.holdBay.items)
    for (const [id, bay] of before.slice(1)) expect(pos.get(id!)).toBe(bay)
    expect(sim.dispatch({ kind: 'debugFillHoldBay' })).toEqual({ ok: true })
    const added = vs.holdBay.items.find(
      (i) => !before.some(([id]) => id === i.parcelId),
    )
    expect(added?.bay).toBe(0)
  })

  it('holdBayPositions keeps reported bays and gives unreported parcels the lowest free one', () => {
    const pos = lr.holdBayPositions(
      [10, 11, 12],
      [
        { parcelId: 11, bay: 2 },
        { parcelId: 99, bay: 0 }, // not in the queue: ignored
      ],
    )
    expect([...pos.entries()].toSorted((a, b) => a[0] - b[0])).toEqual([
      [10, 0],
      [11, 2],
      [12, 1],
    ])
  })
})

describe('§7.4 payroll rows of the desk card', () => {
  it('re-hire costs one day of the worker’s own salary (the sim’s fee), dimmed below it', () => {
    const sim = makeSim(1)
    const e = sim.state.employees.find((x) => x.role === 'inspector')!
    expect(sc.rehireFee(data, e.salaryPerDay)).toBe(payroll.rehireFee(sim, e))
    expect(sc.rehireLabel(sc.rehireFee(data, e.salaryPerDay))).toBe(
      'Re-hire $20',
    )
    expect(sc.rehireBlockReason(19, 20)).toBe('Not enough money')
    expect(sc.rehireBlockReason(20, 20)).toBeNull()
  })

  it('a walked-out inspector holds a seat until re-hired: Hire reads "Seat held for re-hire" exactly when the sim says desk-full', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    sim.state.economy.balance = 1000
    expect(hireInspector(sim).ok).toBe(true)
    expect(hireInspector(sim).ok).toBe(true)
    const lin = sim.state.employees.find(
      (x) => x.role === 'inspector' && x.id === desk(sim).f.inspectorIds[1],
    )!
    payroll.walkOut(sim, lin)
    const { node, f } = desk(sim)
    expect(f.inspectorIds).toHaveLength(2)
    expect(f.walkedOutIds).toEqual([lin.id])
    expect(node.stations).toHaveLength(2)
    const max = data.employees.desks.maxPerDesk
    const why = sc.hireBlockReason(
      f.inspectorIds.length,
      max,
      f.walkedOutIds.length,
    )
    expect(why).toBe(sc.SEAT_HELD_TEXT)
    expect(hireInspector(sim)).toEqual({ ok: false, reason: 'desk-full' })
    // The card lists Lin as a walked-out row (Re-hire + Fire).
    const rows = sc.deskPersonRows(f, vs.people())
    expect(rows.map((r) => [r.person.id, r.seated])).toEqual([
      [f.inspectorIds[0], true],
      [f.inspectorIds[1], true],
      [lin.id, false],
    ])
    // Re-hire: back at the desk, the station returns, the fee is paid.
    const bal = vs.money
    expect(vs.lane.rehire(lin.id)).toEqual({ ok: true })
    expect(desk(sim).f.inspectorIds).toContain(lin.id)
    expect(desk(sim).node.stations).toHaveLength(3)
    expect(vs.money).toBe(bal - sc.rehireFee(data, lin.salaryPerDay))
  })

  it('Fire on a walked-out row frees the held seat at once (design D10)', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    sim.state.economy.balance = 1000
    hireInspector(sim)
    hireInspector(sim)
    const lin = sim.state.employees.find(
      (x) => x.id === desk(sim).f.inspectorIds[2],
    )!
    payroll.walkOut(sim, lin)
    expect(vs.fire(lin.id)).toEqual({ ok: true })
    const { f } = desk(sim)
    expect(f.walkedOutIds).toEqual([])
    expect(
      sc.hireBlockReason(
        f.inspectorIds.length,
        data.employees.desks.maxPerDesk,
        f.walkedOutIds.length,
      ),
    ).toBeNull()
  })

  it('the re-hire is refused below the fee (the button is dimmed for the same reason)', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    const e = sim.state.employees.find((x) => x.role === 'inspector')!
    payroll.walkOut(sim, e)
    sim.state.economy.balance = 5
    expect(
      sc.rehireBlockReason(vs.money, sc.rehireFee(data, e.salaryPerDay)),
    ).not.toBeNull()
    expect(vs.lane.rehire(e.id)).toEqual({
      ok: false,
      reason: 'insufficient-funds',
    })
  })

  it('the salary line counts the seated inspectors only', () => {
    expect(sc.salaryLine(20, 230)).toBe('Salaries $20/day · Payday in 0:23')
  })
})

describe('§3.1 CLEAR wears the green confirm face (art STYLE §7)', () => {
  it('up / pressed use ui_btn_green / _down; disabled keeps the kit frame', () => {
    expect(hb.greenFace('normal')).toBe('ui_btn_green')
    expect(hb.greenFace('glow')).toBe('ui_btn_green')
    expect(hb.greenFace('down')).toBe('ui_btn_green_down')
    expect(hb.greenFace('disabled')).toBeNull()
    const frames = FRAMES as Record<string, string>
    expect(frames.ui_btn_green).toBeDefined()
    expect(frames.ui_btn_green_down).toBeDefined()
  })
})
