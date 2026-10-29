// plan.md §12.9 summary card (pure formatting): the title `Run summary —
// seed 7 — 12:22 played`; the rows lifetime earned / deliveries (on-time %)
// / first delivery at / first malware caught at (by whom) / level 2 at /
// malware spawned · caught · missed / lives lost (label + counter machine
// each) / fleet bought / inspectors · machines / taps per min / fps p50 ·
// p5; the fun-bar checklist (1)-(5) as ticks / crosses / you judge / not
// yet from the same object; and the plain text `Copy summary` puts on the
// clipboard. Phaser is stubbed (the module imports the Button kit).
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
const { funBar } = await import('../../src/metrics/playtest.ts')
const { dataFixture } = await import('../sim/helpers.ts')
type Playtest = import('../../src/metrics/playtest.ts').Playtest

const data = dataFixture()
const targets = data.economy.pacingTargets

/** The plan's illustrative profile (§12.9). */
function example(over: Partial<Playtest> = {}): Playtest {
  return {
    version: 1,
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
    elapsedS: 742,
    simS: 731,
    pausedS: 11,
    firstDeliveryS: 47,
    firstMalware: {
      spawnedS: 121,
      caughtS: 158,
      by: 'inspector',
      tossedS: 166,
    },
    level2AtS: 801,
    truckBoughtS: null,
    deliveries: {
      total: 61,
      onTime: 55,
      late: 6,
      byType: { bike: 61, van: 0, truck: 0 },
    },
    moneyPerMin: [20, 48, 70, 72, 95, 140, 150, 160, 155, 170, 190, 200],
    lifetimeEarned: 1810,
    balanceEnd: 410,
    malware: { spawned: 4, caught: 3, missed: 1, tossedClean: 1, cleared: 0 },
    livesLost: [
      {
        atS: 612,
        label: 'l0dash',
        strain: 'metal',
        laneRate: 0.85,
        counter: 'metal_detector',
        clearedByPlayer: false,
      },
    ],
    vehiclesBought: [
      { type: 'bike', atS: 0 },
      { type: 'bike', atS: 281 },
    ],
    inspectorsHired: 0,
    machinesBought: [{ id: 'metal_detector', atS: 9 }],
    taps: 188,
    tapsPerMin: 15.2,
    rushTaps: 9,
    viewSwitches: 14,
    warehouseS: 203,
    fps: { p50: 59, p5: 41, min: 22, samples: 742 },
    holdBayEvents: 7,
    holdBayEventsPer10Min: 5.7,
    stalls: { count: 2, totalS: 31 },
    payroll: { paid: 12, short: 0, walkouts: 0 },
    satisfactionEnd: { highres: 84, downtown: 71 },
    ...over,
  }
}

function life(label: string, counter: string | null, cleared: boolean) {
  return {
    atS: 600,
    label,
    strain: 'metal',
    laneRate: 0.85,
    counter,
    clearedByPlayer: cleared,
  }
}

function state(pt: Playtest, opened: number | null = null) {
  return funBar(pt, targets, opened).map((c) => c.state)
}

describe('§12.9 title: `Run summary — seed 7 — 12:22 played`', () => {
  it('uses the wall time played (elapsedS) as m:ss', () => {
    expect(sc.summaryTitle(example())).toBe(
      'Run summary — seed 7 — 12:22 played',
    )
    expect(sc.summaryTitle(example({ seed: 12345, elapsedS: 59.9 }))).toBe(
      'Run summary — seed 12345 — 0:59 played',
    )
    expect(sc.summaryTitle(example({ elapsedS: 3725 }))).toBe(
      'Run summary — seed 7 — 62:05 played',
    )
  })
})

describe('§12.9 rows, in order', () => {
  it('lists every row with its value', () => {
    expect(sc.summaryRows(example(), data)).toEqual([
      { label: 'Lifetime earned', value: '$1,810' },
      { label: 'Deliveries', value: '61 (90% on time)' },
      { label: 'First delivery at', value: '0:47' },
      { label: 'First malware caught at', value: '2:38 · Inspector' },
      { label: 'Level 2 at', value: '13:21' },
      { label: 'Malware spawned · caught · missed', value: '4 · 3 · 1' },
      { label: 'Lives lost', value: '1' },
      { label: 'l0dash', value: 'Metal detector', sub: true },
      { label: 'Fleet bought', value: '2 bikes' },
      { label: 'Inspectors · machines', value: '0 · 1' },
      { label: 'Taps per min', value: '15.2' },
      { label: 'FPS p50 · p5', value: '59 · 41' },
    ])
  })

  it('says `not yet` / `none` for what has not happened', () => {
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
    expect(v['First delivery at']).toBe('not yet')
    expect(v['First malware caught at']).toBe('not yet')
    expect(v['Level 2 at']).toBe('not yet')
    expect(v['Lives lost']).toBe('none')
    expect(v['Fleet bought']).toBe('none')
    expect(v['FPS p50 · p5']).toBe('—')
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

  it('lists each lost life (label + counter machine; Cleared by you), at most three', () => {
    const rows = sc.summaryRows(
      example({
        livesLost: [
          life('l0dash', 'metal_detector', true),
          life('faker@6.6.6', 'shaky_shaker', false),
          life('evil-lodash', null, false),
          life('cr0ss-env', 'metal_detector', false),
        ],
      }),
      data,
    )
    expect(rows.filter((r) => r.sub)).toEqual([
      { label: 'l0dash', value: 'Metal detector · cleared by you', sub: true },
      { label: 'faker@6.6.6', value: 'Shaky shaker', sub: true },
      { label: 'evil-lodash', value: 'no counter', sub: true },
      { label: '… and 1 more', value: '', sub: true },
    ])
    expect(rows.find((r) => r.label === 'Lives lost')?.value).toBe('4')
  })
})

describe('§12.9 fun bar: ticks, crosses, you judge, not yet', () => {
  it('(1) first delivery < 60 s; (2) malware caught by 5:00; (3) L2 in 8–15 min', () => {
    expect(state(example()).slice(0, 3)).toEqual(['pass', 'pass', 'pass'])
    expect(
      state(
        example({
          firstDeliveryS: 61,
          firstMalware: {
            spawnedS: 100,
            caughtS: 301,
            by: 'inspector',
            tossedS: null,
          },
          level2AtS: 470,
        }),
      ).slice(0, 3),
    ).toEqual(['fail', 'fail', 'fail'])
    expect(state(example({ level2AtS: 901 }))[2]).toBe('fail')
  })

  it('a window still open reads `not yet` (pending); a closed one without the event fails', () => {
    const early = example({
      simS: 40,
      firstDeliveryS: null,
      firstMalware: { spawnedS: null, caughtS: null, by: null, tossedS: null },
      level2AtS: null,
    })
    expect(state(early).slice(0, 3)).toEqual(['pending', 'pending', 'pending'])
    const late = example({
      simS: 950,
      firstDeliveryS: null,
      firstMalware: { spawnedS: null, caughtS: null, by: null, tossedS: null },
      level2AtS: null,
    })
    expect(state(late).slice(0, 3)).toEqual(['fail', 'fail', 'fail'])
  })

  it('(4) played past 15:00 before the summary first opened', () => {
    expect(state(example())[3]).toBe('fail') // 12:22
    expect(state(example({ elapsedS: 1210 }))[3]).toBe('pass')
    // Opened at 10:00, reopened at 20:10: the first opening counts.
    expect(state(example({ elapsedS: 1210 }), 600)[3]).toBe('fail')
    expect(funBar(example(), targets)[3]?.detail).toBe('summary at 12:22')
  })

  it('(5) every lost life explainable: the data says so, the author judges', () => {
    expect(state(example())[4]).toBe('judge')
    expect(state(example({ livesLost: [] }))[4]).toBe('pass')
    const unexplained = example({
      livesLost: [
        {
          atS: 600,
          label: 'mystery',
          strain: null,
          laneRate: 0,
          counter: null,
          clearedByPlayer: false,
        },
      ],
    })
    expect(state(unexplained)[4]).toBe('fail')
  })
})

describe('§12.9 `Copy summary`: the card as plain text', () => {
  it('title, rows, the checklist with marks, build and device', () => {
    const pt = example()
    const text = sc.summaryText(pt, data, sc.summaryChecks(pt, data))
    expect(text.split('\n')).toEqual([
      'Run summary — seed 7 — 12:22 played',
      'Lifetime earned: $1,810',
      'Deliveries: 61 (90% on time)',
      'First delivery at: 0:47',
      'First malware caught at: 2:38 · Inspector',
      'Level 2 at: 13:21',
      'Malware spawned · caught · missed: 4 · 3 · 1',
      'Lives lost: 1',
      '  - l0dash: Metal detector',
      'Fleet bought: 2 bikes',
      'Inspectors · machines: 0 · 1',
      'Taps per min: 15.2',
      'FPS p50 · p5: 59 · 41',
      'Fun bar:',
      '[x] 1. First delivery under 1:00 (0:47)',
      '[x] 2. Malware caught by 5:00 (2:38)',
      '[x] 3. Level 2 between 8:00 and 15:00 (13:21)',
      '[ ] 4. Kept playing past 15:00 (summary at 12:22)',
      '[?] 5. Every lost life explained (you judge)',
      'Build a1b2c3d 2026-10-30 · started 2026-10-30T18:02:11Z · 393×852 @3x zoom 1',
      'iPhone',
    ])
    expect(sc.funMark('pending')).toBe('[-]')
  })
})
