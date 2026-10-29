// M3 HUD rules (plan.md §12.6 task 7; city-view.md §4.1, §4.3, §8.1, §9.6-§9.7;
// spec §7.3-§7.4, §8, §9.2): the level bar at the playtest cap, the payday
// and payroll-short toasts, the walkout line, the Garage `!` on a short
// payday, the region / strain / mood ticker lines, the Garage rows after a
// walkout (No driver, Re-hire $8) and the `Now playing` toast. Pure helpers
// only; Phaser is stubbed for the Garage module's Button kit.
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

const kit = await import('../../src/ui/hudKit.ts')
const garage = await import('../../src/scenes/GarageSheet.ts')
const { dataFixture } = await import('../sim/helpers.ts')

import type { VehicleSnapshot } from '../../src/sim/view-api.ts'

const data = dataFixture()

function snap(over: Partial<VehicleSnapshot> = {}): VehicleSnapshot {
  return {
    id: 2,
    type: 'bike',
    name: 'Bike 2',
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

describe('city-view §4.1: the level bar against nextThreshold', () => {
  it('Lv1: "$1,240 / $2,000" over the Lv1 → Lv2 span', () => {
    const p = kit.levelProgress(data, 1, 1240, 2000)
    expect(p.text).toBe('$1,240 / $2,000')
    expect(p.frac).toBeCloseTo(0.62)
    expect(kit.levelLabel(data, 2)).toBe('Lv2 Local')
  })

  it('at playtestMaxLevel: "$3,410 / $5,000 · Lv 3 coming soon", never "next build"', () => {
    expect(data.economy.playtestMaxLevel).toBe(2)
    const p = kit.levelProgress(data, 2, 3410, 5000)
    expect(p.text).toBe('$3,410 / $5,000 · Lv 3 coming soon')
    expect(p.frac).toBeCloseTo((3410 - 2000) / 3000)
    expect(p.text).not.toMatch(/build/i)
    expect(kit.nextUnlockLine(data, 2)).toBe('Lv 3 coming soon')
  })

  it('§9.6 step 4: the bar starts again from 0 right at the threshold', () => {
    expect(kit.levelProgress(data, 2, 2000, 5000).frac).toBe(0)
  })
})

describe('city-view §9.7: payday and payroll-short', () => {
  it('"Payday — payroll −$28" with the amount drawn red', () => {
    const t = kit.paydayToast(28)
    expect(t.text).toBe('Payday — payroll −$28')
    expect(t.text.slice(t.redFrom)).toBe('−$28')
  })

  it('"Payroll short: Audrey unpaid" (names joined when several)', () => {
    expect(kit.payrollShortLine(['Audrey'])).toBe(
      'Payroll short: Audrey unpaid',
    )
    expect(kit.payrollShortLine(['Audrey', 'Dee'])).toBe(
      'Payroll short: Audrey, Dee unpaid',
    )
  })

  it('§8.1 walkout lines name the desk or the vehicle left without a driver', () => {
    expect(kit.walkoutLine('Audrey', 'inspector', null)).toBe(
      'Audrey walked out — desk short-handed',
    )
    expect(kit.walkoutLine('Dee', 'driver', 'Bike 2')).toBe(
      'Dee walked out — Bike 2 has no driver',
    )
  })
})

describe('spec §7.4: the walkouts of one payday make one toast and one paper', () => {
  it('"Audrey, Dee and Pax walked out — unpaid 2 paydays running"', () => {
    expect(data.employees.walkoutAfterUnpaidPaydays).toBe(2)
    expect(kit.joinNames(['Audrey'])).toBe('Audrey')
    expect(kit.joinNames(['Audrey', 'Dee'])).toBe('Audrey and Dee')
    expect(
      kit.walkoutGroupLine(
        ['Audrey', 'Dee', 'Pax'],
        data.employees.walkoutAfterUnpaidPaydays,
      ),
    ).toBe('Audrey, Dee and Pax walked out — unpaid 2 paydays running')
  })
})

describe('city-view §4.3: the Garage "!" badge', () => {
  it('rises on a short payday (an unpaid inspector too), a walkout or an inactive vehicle', () => {
    expect(kit.garageAlert([snap()], false)).toBe(false)
    expect(kit.garageAlert([snap()], true)).toBe(true)
    expect(kit.garageAlert([snap({ unpaid: true })])).toBe(true)
    expect(kit.garageAlert([snap({ driverName: null })])).toBe(true)
    expect(kit.garageAlert([snap({ state: 'inactive' })])).toBe(true)
  })
})

describe('city-view §8.1: region, strain and mood ticker lines', () => {
  it('region: "Hoist Hill is now open"', () => {
    expect(kit.regionOpenLine(data, 'industrial')).toBe(
      'Hoist Hill is now open',
    )
  })

  it('strain: "New strain spotted: rattle" once announced + newStrainDelayS', () => {
    expect(kit.strainLine('rattle')).toBe('New strain spotted: rattle')
    const delay = data.parcels.malware.newStrainDelayS * 10
    expect(kit.strainsLive({ rattle: 9000 }, 9000 + delay - 1, delay)).toEqual(
      [],
    )
    expect(kit.strainsLive({ rattle: 9000 }, 9000 + delay, delay)).toEqual([
      'rattle',
    ])
  })

  it('mood: crossing below loudBelow (30) / up to happyAbove (80) only', () => {
    const s = data.economy.satisfaction
    expect(s.loudBelow).toBe(30)
    expect(s.happyAbove).toBe(80)
    expect(kit.moodLine(data, 'highres', 29, -2)).toBe(
      'Node Heights is grumbling',
    )
    expect(kit.moodLine(data, 'downtown', 80, 2)).toBe(
      'Registry Row loves the service',
    )
    expect(kit.moodLine(data, 'highres', 28, -1)).toBeNull()
    expect(kit.moodLine(data, 'downtown', 82, 2)).toBeNull()
    expect(kit.moodLine(data, 'highres', 50, 5)).toBeNull()
  })
})

describe('city-view §7.2 / spec §7.4: Garage rows after a walkout', () => {
  it('a vehicle without a driver offers "Re-hire $8" (one day of salary), even before it parks inactive', () => {
    const walked = garage.rowAction(
      snap({ driverName: null, state: 'delivering' }),
      data,
      3,
      true,
    )
    expect(walked).toMatchObject({
      kind: 'rehire',
      label: 'Re-hire $8',
      enabled: true,
    })
    const parked = garage.rowAction(
      snap({ driverName: null, state: 'inactive', type: 'truck' }),
      data,
      3,
      true,
    )
    expect(parked.label).toBe('Re-hire $25')
  })

  it('"No driver" reads red like the badge; a re-hire toasts the driver back', () => {
    expect(garage.driverLine(snap({ driverName: null }), data)).toEqual({
      text: 'No driver',
      red: true,
    })
    expect(garage.rehiredToast('Bike 2', 'Dee')).toBe(
      'Dee is back — Bike 2 on the road',
    )
  })

  it('the header reads "Payroll $44/day" and "Payday in 0:23"', () => {
    expect(garage.payrollText(44)).toBe('Payroll $44/day')
    expect(garage.paydayText(230)).toBe('Payday in 0:23')
  })
})

describe('audio.md §3 item 8: the now-playing toast', () => {
  it('"Now playing: Semver Swing" (m5x7 has no ♪ glyph)', () => {
    expect(kit.nowPlayingText('Semver Swing')).toBe('Now playing: Semver Swing')
    expect(kit.TAP_FOR_SOUND_TEXT).toBe('Tap for sound')
  })
})
