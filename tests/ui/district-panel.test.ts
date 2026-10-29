// city-view.md §5.1 (district half-sheet rows 1-7), spec §9.2 (trend,
// loud districts), §9.4 (70 / 40 bands), §3.3 + §4.1 (Industrial trucks
// only), §3.5 + §8 (unlock line from levels.json). Pure helpers only; Phaser
// is stubbed because DistrictPanel imports the Button kit.
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

const dp = await import('../../src/ui/DistrictPanel.ts')
const { dataFixture } = await import('../sim/helpers.ts')

const data = dataFixture()
const district = (id: string) => {
  const d = data.districts.find((x) => x.id === id)
  if (!d) throw new Error(id)
  return d
}

describe('District panel (city-view §5.1)', () => {
  it('sheet height is max(280, round(H × 0.5))', () => {
    expect(dp.districtSheetHeight(500)).toBe(280)
    expect(dp.districtSheetHeight(659)).toBe(330)
  })

  it('satisfaction bar is green ≥ 70, amber 40–69, red < 40 (spec §9.4 bands)', () => {
    expect(dp.satisfactionColour(100)).toBe('green')
    expect(dp.satisfactionColour(70)).toBe('green')
    expect(dp.satisfactionColour(69)).toBe('amber')
    expect(dp.satisfactionColour(40)).toBe('amber')
    expect(dp.satisfactionColour(39)).toBe('red')
  })

  it('loud districts: below economy loudBelow grumble, at happyAbove they love the service', () => {
    const s = data.economy.satisfaction
    expect(dp.moodNote(s.loudBelow - 1, data)).toEqual({
      icon: 'ic_angry',
      text: 'Residents are grumbling',
    })
    expect(dp.moodNote(s.loudBelow, data)).toBeNull()
    expect(dp.moodNote(s.happyAbove - 1, data)).toBeNull()
    expect(dp.moodNote(s.happyAbove, data)).toEqual({
      icon: 'ic_flower',
      text: 'Loves the service',
    })
  })

  it('favoured vehicle line uses districts.json favoured + economy favouredBonus', () => {
    expect(dp.favouredLine(district('highres'), data)).toBe(
      'Favours: bike (+1 satisfaction)',
    )
    expect(dp.favouredLine(district('downtown'), data)).toBe(
      'Favours: van (+1 satisfaction)',
    )
    expect(dp.favouredLine(district('industrial'), data)).toBeNull()
    expect(dp.favouredLine(district('docks'), data)).toBeNull()
  })

  it('Industrial reads "Trucks only — bikes and vans never enter" and "No truck yet (Lv 2, $1,300)" until a truck is owned', () => {
    const ind = district('industrial')
    expect(dp.vehicleRuleLine(ind, data)).toBe(
      'Trucks only — bikes and vans never enter',
    )
    expect(dp.missingVehicleLine(ind, data, ['bike', 'van'])).toBe(
      'No truck yet (Lv 2, $1,300)',
    )
    expect(dp.missingVehicleLine(ind, data, ['bike', 'truck'])).toBeNull()
    expect(dp.vehicleRuleLine(district('highres'), data)).toBeNull()
    expect(dp.missingVehicleLine(district('highres'), data, [])).toBeNull()
  })

  it('a locked region reads "Unlocks at Lv 2 — $2,000 lifetime earned" (levels.json threshold)', () => {
    expect(dp.lockedLine(district('industrial'), data)).toBe(
      'Unlocks at Lv 2 — $2,000 lifetime earned',
    )
    expect(dp.lockedLine(district('docks'), data)).toBe(
      'Unlocks at Lv 3 — $5,000 lifetime earned',
    )
  })

  it('waiting line counts parcels and buildings and tints the oldest age by its decay phase', () => {
    expect(
      dp.waitingLine(
        { waitingCount: 0, waitingBuildings: 0, oldestWaitingS: null },
        data,
      ),
    ).toBeNull()
    const grace = data.parcels.decay.graceS
    expect(
      dp.waitingLine(
        { waitingCount: 7, waitingBuildings: 3, oldestWaitingS: 100.4 },
        data,
      ),
    ).toEqual({
      text: 'Waiting parcels: 7 at 3 buildings · oldest ',
      age: '1:40',
      phase: 100.4 > grace ? 'amber' : 'plain',
    })
    expect(
      dp.waitingLine(
        { waitingCount: 1, waitingBuildings: 1, oldestWaitingS: 5 },
        data,
      ),
    ).toMatchObject({ text: 'Waiting parcels: 1 at 1 building · oldest ' })
    expect(
      dp.waitingLine(
        {
          waitingCount: 2,
          waitingBuildings: 1,
          oldestWaitingS: data.parcels.onTimeMaxS + 1,
        },
        data,
      )?.phase,
    ).toBe('red')
  })

  it('the waiting row pans to the building with the most waiting parcels (ties: the oldest)', () => {
    const buildings = [
      { id: 'a', district: 'highres' },
      { id: 'b', district: 'highres' },
      { id: 'c', district: 'highres' },
      { id: 'x', district: 'downtown' },
    ]
    const waiting: Record<string, { spawnedTick: number }[]> = {
      a: [{ spawnedTick: 50 }],
      b: [{ spawnedTick: 40 }, { spawnedTick: 90 }],
      c: [{ spawnedTick: 10 }, { spawnedTick: 95 }],
      x: [{ spawnedTick: 1 }, { spawnedTick: 2 }, { spawnedTick: 3 }],
    }
    const of = (id: string) => waiting[id] ?? []
    expect(dp.busiestBuilding(buildings, 'highres', of)).toBe('c')
    expect(dp.busiestBuilding(buildings, 'downtown', of)).toBe('x')
    expect(dp.busiestBuilding(buildings, 'industrial', of)).toBeNull()
  })

  it('row copy: earned and homed lines', () => {
    expect(dp.earnedLine(1240)).toBe('Earned here: $1,240')
    expect(dp.homedLine(2)).toBe('Vehicles homed here: 2')
  })
})
