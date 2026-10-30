// plan.md §12.9 summary card, v2 plan-build2 §8.7 task 2 / §9 (pure
// formatting): the title `Run summary — seed 7 — 35:12 played`; the rows
// lifetime earned / deliveries (on-time %) / first delivery · catch (by
// whom) / levels 2 · 3 · 4 · 5 / Victory (+ endless) / malware spawned ·
// caught · missed / lives lost (label + what explains each: counter
// machine, sorter call, cleared by you, the ship has sailed) / fleet bought
// / hires · fired · ads / quests offered · done · failed / sorter calls ·
// wrong / overseas cleared · malware / machines · docks · desks / taps per
// min · fps p50 · p5; the fun bar 2 checklist (1)-(6) as ticks / crosses /
// you judge / not yet from the same object; the plain text `Copy summary`
// puts on the clipboard; and the row pitch that keeps the card inside
// 360×604. Phaser is stubbed (the module imports the Button kit).
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

const sc = await import('../../src/ui/SummaryCard.ts')
const { funBar, FUN_TARGETS } = await import('../../src/metrics/playtest.ts')
const { LINE_H } = await import('../../src/ui/text.ts')
const { dataFixture } = await import('../sim/helpers.ts')
type Playtest = import('../../src/metrics/playtest.ts').Playtest
type PlaytestHire = import('../../src/metrics/playtest.ts').PlaytestHire

const data = dataFixture()
const targets = FUN_TARGETS

/** The plan's illustrative profile (§12.9), a 35-minute v2 run. */
function example(over: Partial<Playtest> = {}): Playtest {
  return {
    version: 2,
    buildStamp: 'a1b2c3d 2026-10-30',
    seed: 7,
    startedAt: '2026-10-30T18:02:11Z',
    device: {
      ua: 'iPhone',
      cssW: 393,
      cssH: 852,
      dpr: 3,
      zoom: 1,
      maxTexture: 8192,
    },
    elapsedS: 2112,
    simS: 2100,
    pausedS: 11,
    firstDeliveryS: 47,
    firstMalware: {
      spawnedS: 121,
      caughtS: 158,
      by: 'inspector',
      tossedS: 166,
    },
    level2AtS: 801,
    level3AtS: 1130,
    level4AtS: 1490,
    level5AtS: null,
    victoryAtS: null,
    endlessS: null,
    truckBoughtS: 860,
    deliveries: {
      total: 261,
      onTime: 225,
      late: 36,
      byType: { bike: 161, van: 40, truck: 60 },
    },
    moneyPerMin: [20, 48, 70, 72, 95, 140, 150, 160, 155, 170, 190, 200],
    lifetimeEarned: 9810,
    balanceEnd: 410,
    malware: { spawned: 24, caught: 21, missed: 1, tossedClean: 3, cleared: 0 },
    livesLost: [
      {
        parcelId: 41,
        atS: 612,
        label: 'l0dash',
        strain: 'metal',
        laneRate: 0.85,
        counter: 'metal_detector',
        clearedByPlayer: false,
        sorter: null,
        hub: null,
      },
    ],
    vehiclesBought: [
      { type: 'bike', atS: 0 },
      { type: 'bike', atS: 281 },
      { type: 'truck', atS: 860 },
    ],
    inspectorsHired: 1,
    machinesBought: [
      { id: 'metal_detector', atS: 9 },
      { id: 'shaky_shaker', atS: 830 },
    ],
    docksBought: [{ index: 2, atS: 1250 }],
    desks: 2,
    hires: [
      hire({ role: 'driver', cheapest: true }),
      hire({ role: 'driver', atS: 281, cheapest: false }),
      hire({ role: 'inspector', atS: 1300, cheapest: true }),
    ],
    fired: 1,
    adsPosted: 2,
    sorter: { decisions: 14, wrong: 2, clearedMalware: 1 },
    quests: {
      offered: 9,
      accepted: 6,
      declined: 2,
      completed: 4,
      failed: 2,
      firstCompletedS: 560,
      byTemplate: {
        rush_district: {
          offered: 3,
          accepted: 3,
          declined: 0,
          completed: 2,
          failed: 1,
        },
      },
    },
    overseas: { handedOff: 14, cleared: 12, malwareAtClearance: 0 },
    taps: 588,
    tapsPerMin: 16.7,
    rushTaps: 9,
    viewSwitches: 34,
    warehouseS: 603,
    fps: { p50: 59, p5: 41, min: 22, samples: 2112 },
    holdBayEvents: 37,
    holdBayEventsPer10Min: 10.6,
    stalls: { count: 2, totalS: 31 },
    payroll: { paid: 35, short: 0, walkouts: 0 },
    satisfactionEnd: { highres: 84, downtown: 71 },
    ...over,
  }
}

function hire(over: Partial<PlaytestHire> = {}): PlaytestHire {
  return {
    role: 'driver',
    pips: { speed: 3, energy: 2, charisma: 0 },
    salary: 7,
    star: false,
    atS: 0,
    cheapest: true,
    ...over,
  }
}

function life(
  label: string,
  counter: string | null,
  cleared: boolean,
  more: { sorter?: string; hub?: string } = {},
) {
  return {
    parcelId: null,
    atS: 600,
    label,
    strain: 'metal',
    laneRate: 0.85,
    counter,
    clearedByPlayer: cleared,
    sorter: more.sorter ?? null,
    hub: more.hub ?? null,
  }
}

function state(pt: Playtest, opened: number | null = null) {
  return funBar(pt, targets, opened).map((c) => c.state)
}

describe('§12.9 title: `Run summary — seed 7 — 35:12 played`', () => {
  it('uses the wall time played (elapsedS) as m:ss', () => {
    expect(sc.summaryTitle(example())).toBe(
      'Run summary — seed 7 — 35:12 played',
    )
    expect(sc.summaryTitle(example({ seed: 12345, elapsedS: 59.9 }))).toBe(
      'Run summary — seed 12345 — 0:59 played',
    )
    expect(sc.summaryTitle(example({ elapsedS: 3725 }))).toBe(
      'Run summary — seed 7 — 62:05 played',
    )
  })
})

describe('plan-build2 §8.7 task 2: the v2 rows, in order', () => {
  it('lists every row with its value', () => {
    expect(sc.summaryRows(example(), data)).toEqual([
      { label: 'Lifetime earned', value: '$9,810' },
      { label: 'Deliveries', value: '261 (86% on time)' },
      { label: 'First delivery · catch', value: '0:47 · 2:38 Inspector' },
      { label: 'Level 2 · 3 · 4 · 5', value: '13:21 · 18:50 · 24:50 · —' },
      { label: 'Victory', value: 'not yet' },
      { label: 'Malware spawned · caught · missed', value: '24 · 21 · 1' },
      { label: 'Lives lost', value: '1' },
      { label: 'l0dash', value: 'Metal detector', sub: true },
      { label: 'Fleet bought', value: '2 bikes, 1 truck' },
      { label: 'Hires · fired · ads', value: '3 · 1 · 2' },
      { label: 'Quests offered · done · failed', value: '9 · 4 · 2' },
      { label: 'Sorter calls · wrong', value: '14 · 2' },
      { label: 'Overseas cleared · malware', value: '12 · 0' },
      { label: 'Machines · docks · desks', value: '2 · 1 · 2' },
      { label: 'Taps/min · FPS p50 · p5', value: '16.7 · 59 · 41' },
    ])
  })

  it('Victory reads its time and the endless time since', () => {
    const rows = sc.summaryRows(
      example({ level5AtS: 1700, victoryAtS: 2400, endlessS: 190 }),
      data,
    )
    const v = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(v['Level 2 · 3 · 4 · 5']).toBe('13:21 · 18:50 · 24:50 · 28:20')
    expect(v['Victory']).toBe('40:00 · endless 3:10')
  })

  it('says `not yet` / `none` / `—` for what has not happened', () => {
    const rows = sc.summaryRows(
      example({
        firstDeliveryS: null,
        firstMalware: {
          spawnedS: null,
          caughtS: null,
          by: null,
          tossedS: null,
        },
        level2AtS: null,
        level3AtS: null,
        level4AtS: null,
        deliveries: {
          total: 0,
          onTime: 0,
          late: 0,
          byType: { bike: 0, van: 0, truck: 0 },
        },
        livesLost: [],
        vehiclesBought: [],
        fps: { p50: 0, p5: 0, min: 0, samples: 0 },
      }),
      data,
    )
    const v = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(v['Deliveries']).toBe('none yet')
    expect(v['First delivery · catch']).toBe('not yet · not yet')
    expect(v['Level 2 · 3 · 4 · 5']).toBe('— · — · — · —')
    expect(v['Victory']).toBe('not yet')
    expect(v['Lives lost']).toBe('none')
    expect(v['Fleet bought']).toBe('none')
    expect(v['Taps/min · FPS p50 · p5']).toBe('16.7 · —')
  })

  it('names the catching machine; the fleet by type in vehicles.json order', () => {
    expect(sc.checkerName(data, 'metal_detector')).toBe('Metal detector')
    expect(sc.checkerName(data, 'shaky_shaker')).toBe('Shaky shaker')
    expect(sc.checkerName(data, 'inspector')).toBe('Inspector')
    expect(
      sc.fleetLine(
        [
          { type: 'truck' },
          { type: 'bike' },
          { type: 'van' },
          { type: 'bike' },
        ],
        data,
      ),
    ).toBe('2 bikes, 1 van, 1 truck')
    expect(
      sc.onTimePct({
        total: 3,
        onTime: 2,
        late: 1,
        byType: { bike: 3, van: 0, truck: 0 },
      }),
    ).toBe(67)
  })

  it('lists each lost life with what explains it (counter, sorter, Clear, the ship has sailed), at most three', () => {
    const rows = sc.summaryRows(
      example({
        livesLost: [
          life('l0dash', 'metal_detector', true),
          life('faker@6.6.6', 'shaky_shaker', false, { sorter: 'Mo' }),
          life('evil-lodash', null, false),
          life('cr0ss-env', 'metal_detector', false),
        ],
      }),
      data,
    )
    expect(rows.filter((r) => r.sub)).toEqual([
      { label: 'l0dash', value: 'Metal detector · cleared by you', sub: true },
      {
        label: 'faker@6.6.6',
        value: 'Shaky shaker · Mo: looks clean',
        sub: true,
      },
      { label: 'evil-lodash', value: 'no counter', sub: true },
      { label: '… and 1 more', value: '', sub: true },
    ])
    expect(rows.find((r) => r.label === 'Lives lost')?.value).toBe('4')
  })

  it('an overseas loss says the ship has sailed / the plane has left', () => {
    expect(
      sc.lifeLostValue(
        life('b4ttery', 'battery_checker', false, { hub: 'docks' }),
        data,
      ),
    ).toBe('Battery checker · the ship has sailed')
    expect(
      sc.lifeLostValue(life('d3nse', null, false, { hub: 'airport' }), data),
    ).toBe('no counter · the plane has left')
    expect(
      sc.lifeLostValue(life('pkg', null, false, { sorter: 'Pat' }), data),
    ).toBe('Pat: looks clean')
  })
})

describe('plan-build2 §9 fun bar 2: ticks, crosses, you judge, not yet', () => {
  it('reads the example: a choice (you judge), quest by 15:00, L3 in 15-22, 35 min, the card makes sense (you judge), no L5 by 35:00 yet', () => {
    const checks = funBar(example(), targets)
    expect(checks.map((c) => [c.n, c.state, c.detail])).toEqual([
      [1, 'judge', '1 not cheapest · you judge'],
      [2, 'pass', '9:20'],
      [3, 'pass', '18:50'],
      [4, 'pass', 'summary at 35:12'],
      [5, 'judge', 'you judge'],
      [6, 'pending', 'not yet'],
    ])
    expect(checks.map((c) => c.label)).toEqual([
      'Hiring was a choice',
      'A quest done by 15:00',
      'Level 3 between 15:00 and 22:00',
      'Kept playing past 25:00',
      'Every lost life explained',
      'Stretch: Lv 5 or Victory by 40:00',
    ])
  })

  it('(1) every pick the cheapest → cross; no hire yet → not yet', () => {
    expect(
      state(example({ hires: [hire(), hire({ role: 'inspector' })] }))[0],
    ).toBe('fail')
    expect(funBar(example({ hires: [] }), targets)[0]).toMatchObject({
      state: 'pending',
      detail: 'no hires yet',
    })
  })

  it('(2) a quest done by 15:00: late or none fails, still open reads not yet', () => {
    const q = example().quests
    expect(state(example({ quests: { ...q, firstCompletedS: 901 } }))[1]).toBe(
      'fail',
    )
    expect(
      funBar(
        example({ quests: { ...q, completed: 0, firstCompletedS: null } }),
        targets,
      )[1],
    ).toMatchObject({ state: 'fail', detail: 'none by 15:00' })
    expect(
      state(
        example({
          simS: 600,
          quests: { ...q, completed: 0, firstCompletedS: null },
        }),
      )[1],
    ).toBe('pending')
  })

  it('(3) L3 between 15:00 and 22:00', () => {
    expect(state(example({ level3AtS: 899 }))[2]).toBe('fail')
    expect(state(example({ level3AtS: 1320 }))[2]).toBe('pass')
    expect(state(example({ level3AtS: 1321 }))[2]).toBe('fail')
    expect(state(example({ simS: 1200, level3AtS: null }))[2]).toBe('pending')
    expect(state(example({ simS: 1400, level3AtS: null }))[2]).toBe('fail')
  })

  it('(4) played past 25:00 before the summary first opened', () => {
    expect(state(example())[3]).toBe('pass') // 35:12
    expect(state(example({ elapsedS: 1500 }))[3]).toBe('fail')
    // Opened at 20:00 (the old offer), reopened at 35:12: the first opening counts.
    expect(state(example(), 1200)[3]).toBe('fail')
    expect(funBar(example(), targets, 1200)[3]?.detail).toBe('summary at 20:00')
  })

  it('(5) every lost life explainable — a counter, a sorter name or a Clear; the author judges', () => {
    expect(state(example())[4]).toBe('judge')
    expect(state(example({ livesLost: [] }))[4]).toBe('pass')
    expect(
      state(
        example({ livesLost: [life('pkg', null, false, { sorter: 'Mo' })] }),
      )[4],
    ).toBe('judge')
    expect(state(example({ livesLost: [life('pkg', null, true)] }))[4]).toBe(
      'judge',
    )
    const unexplained = example({
      livesLost: [life('mystery', null, false, { hub: 'docks' })],
    })
    expect(funBar(unexplained, targets)[4]).toMatchObject({
      state: 'fail',
      detail: '1 unexplained',
    })
  })

  it('(6) stretch: L5 or Victory by 40:00', () => {
    expect(funBar(example({ level5AtS: 1700 }), targets)[5]).toMatchObject({
      state: 'pass',
      detail: 'Lv 5 28:20',
    })
    expect(
      funBar(example({ level5AtS: 2300, victoryAtS: 2390 }), targets)[5],
    ).toMatchObject({ state: 'pass', detail: 'Victory 39:50' })
    expect(
      funBar(example({ simS: 2500, level5AtS: 2450 }), targets)[5],
    ).toMatchObject({ state: 'fail', detail: 'Lv 5 40:50' })
    expect(funBar(example({ simS: 2500 }), targets)[5]).toMatchObject({
      state: 'fail',
      detail: 'none by 40:00',
    })
  })
})

describe('§12.9 `Copy summary`: the card as plain text', () => {
  it('title, rows, the checklist with marks, build and device', () => {
    const pt = example()
    const text = sc.summaryText(pt, data, sc.summaryChecks(pt))
    expect(text.split('\n')).toEqual([
      'Run summary — seed 7 — 35:12 played',
      'Lifetime earned: $9,810',
      'Deliveries: 261 (86% on time)',
      'First delivery · catch: 0:47 · 2:38 Inspector',
      'Level 2 · 3 · 4 · 5: 13:21 · 18:50 · 24:50 · —',
      'Victory: not yet',
      'Malware spawned · caught · missed: 24 · 21 · 1',
      'Lives lost: 1',
      '  - l0dash: Metal detector',
      'Fleet bought: 2 bikes, 1 truck',
      'Hires · fired · ads: 3 · 1 · 2',
      'Quests offered · done · failed: 9 · 4 · 2',
      'Sorter calls · wrong: 14 · 2',
      'Overseas cleared · malware: 12 · 0',
      'Machines · docks · desks: 2 · 1 · 2',
      'Taps/min · FPS p50 · p5: 16.7 · 59 · 41',
      'Fun bar 2:',
      '[?] 1. Hiring was a choice (1 not cheapest · you judge)',
      '[x] 2. A quest done by 15:00 (9:20)',
      '[x] 3. Level 3 between 15:00 and 22:00 (18:50)',
      '[x] 4. Kept playing past 25:00 (summary at 35:12)',
      '[?] 5. Every lost life explained (you judge)',
      '[-] 6. Stretch: Lv 5 or Victory by 40:00 (not yet)',
      'Build a1b2c3d 2026-10-30 · started 2026-10-30T18:02:11Z · 393×852 @3x zoom 1',
      'iPhone',
    ])
    expect(sc.funMark('pending')).toBe('[-]')
  })
})

describe('the card fits 360×604 (plan-build2 §8.7 task 2)', () => {
  it('the rows keep ROW_H while they fit and close up to LINE_H for a long lives list', () => {
    const titleH = LINE_H
    const checks = 6
    // The usual card: 15 rows at 16 px.
    expect(sc.summaryRowPitch(604, titleH, 15, checks)).toBe(16)
    // The most rows (three lives listed + `… and N more`): 18 still fit at 604.
    expect(sc.summaryRowPitch(604, titleH, 18, checks)).toBe(16)
    // A two-line title on a shorter screen closes the rows up.
    const pitch = sc.summaryRowPitch(570, 2 * titleH, 18, checks)
    expect(pitch).toBeLessThan(16)
    expect(pitch).toBeGreaterThanOrEqual(LINE_H)
    expect(
      sc.summaryBlockH(2 * titleH, 18, checks, pitch) + 2 * 12,
    ).toBeLessThanOrEqual(570)
    // Never tighter than one text line.
    expect(sc.summaryRowPitch(300, titleH, 18, checks)).toBe(LINE_H)
  })

  it('the example card is 15 rows (14 + one lost life); four lost lives make it 18, the most', () => {
    expect(sc.summaryRows(example(), data)).toHaveLength(15)
    const four = example({
      livesLost: [
        life('a', 'metal_detector', false),
        life('b', 'metal_detector', false),
        life('c', 'metal_detector', false),
        life('d', 'metal_detector', false),
      ],
    })
    expect(sc.summaryRows(four, data)).toHaveLength(18)
  })
})
