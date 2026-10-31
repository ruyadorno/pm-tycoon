// city-view.md §5.1 (district half-sheet rows 1-7), spec §9.2 (trend,
// loud districts), §9.4 (70 / 40 bands), §3.3 + §4.1 (Industrial trucks
// only), §3.5 + §8 (unlock line from levels.json); M7 (spec-build2 §3.1,
// design-m7 §6.5) the quest row; M8 (design-m8-m9 §6.3) the overseas hub
// rows (M9: the live Airport at the real L5). Pure helpers only; Phaser is stubbed because DistrictPanel imports
// the Button kit.
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
const {
  dataFixture,
  makeSim,
  noOffers,
  offerQuest,
  acceptOffer,
  fund,
  injectParcel,
  quietSim,
  runTicks,
} = await import('../sim/helpers.ts')
const { handOff } = await import('../../src/sim/systems/hubs.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { questRowText } = await import('../../src/ui/questText.ts')

const data = dataFixture()
const district = (id: string) => {
  const d = data.districts.find((x) => x.id === id)
  if (!d) throw new Error(id)
  return d
}

describe('District panel (city-view §5.1)', () => {
  it('the playtest-1 half-sheet reference is max(280, round(H × 0.5))', () => {
    expect(dp.districtSheetHeight(500)).toBe(280)
    expect(dp.districtSheetHeight(659)).toBe(330)
  })

  it('report §6.14: the sheet fits its rows (pad + safe-area inset under the last one)', () => {
    const full = dp.districtContentBottom({
      locked: false,
      satisfaction: true,
      moodNote: true,
      favouredOrRule: true,
      missing: true,
      waiting: true,
    })
    // header 16 + 28, sat, note, rule, missing, earned (5 × 28), waiting 44, homed 44
    expect(full).toBe(16 + 28 + 5 * 28 + 44 + 44)
    const hub = dp.districtContentBottom({ locked: false })
    expect(hub).toBe(16 + 28 + 28 + 28 + 44)
    expect(
      dp.districtContentBottom({ locked: true, rule: true, signH: 64 }),
    ).toBe(16 + 28 + 28 + 28 + 8 + 64)
    const L = { H: 932, safeTop: 47, safeBottom: 34 }
    expect(dp.districtFitHeight(full, L)).toBe(
      full + dp.DISTRICT_PAD_BOTTOM + 34,
    )
    // 430×932: the old half-sheet was 466 px for ≤ 272 px of rows.
    expect(dp.districtFitHeight(full, L)).toBeLessThan(
      dp.districtSheetHeight(932) - 140,
    )
    // Never past the HUD's top band on a short canvas.
    expect(
      dp.districtFitHeight(full, { H: 300, safeTop: 0, safeBottom: 0 }),
    ).toBe(300 - 64)
  })

  it('report §6.14: every district fits 360×604 and 393×659 (no taller than the old half-sheet)', () => {
    for (const [H, sb] of [
      [604, 0],
      [659, 0],
      [659, 34],
    ] as const) {
      for (const d of data.districts) {
        // Every optional row at once (a sign 96 px tall when locked; M7: a
        // district can be a quest's target).
        const open = dp.districtContentBottom({
          locked: false,
          // M8: a hub has its own rows (a quest may target it too).
          hub: d.kind === 'overseas',
          satisfaction: d.kind === 'district',
          moodNote: d.kind === 'district',
          quest: true,
          favouredOrRule: !!(
            dp.favouredLine(d, data) || dp.vehicleRuleLine(d, data)
          ),
          missing: !!dp.missingVehicleLine(d, data, []),
          waiting: true,
        })
        const locked = dp.districtContentBottom({
          locked: true,
          rule: d.hardRule,
          signH: 96,
        })
        const bottom = d.unlockLevel > 1 ? Math.max(open, locked) : open
        const h = dp.districtFitHeight(bottom, {
          H,
          safeTop: 0,
          safeBottom: sb,
        })
        expect(h, `${d.id} at H ${H}`).toBe(
          bottom + dp.DISTRICT_PAD_BOTTOM + sb,
        )
        expect(h, `${d.id} at H ${H}`).toBeLessThanOrEqual(
          dp.districtSheetHeight(H),
        )
      }
    }
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

  it('Industrial reads "Trucks only — bikes and vans never enter" and "No truck yet (Lv 2, $1,200)" until a truck is owned', () => {
    const ind = district('industrial')
    expect(dp.vehicleRuleLine(ind, data)).toBe(
      'Trucks only — bikes and vans never enter',
    )
    const truck = data.vehicles.types.find((t) => t.id === 'truck')!
    expect(dp.missingVehicleLine(ind, data, ['bike', 'van'])).toBe(
      `No truck yet (Lv 2, $${truck.price.toLocaleString('en-US')})`,
    )
    expect(dp.missingVehicleLine(ind, data, ['bike', 'truck'])).toBeNull()
    expect(dp.vehicleRuleLine(district('highres'), data)).toBeNull()
    expect(dp.missingVehicleLine(district('highres'), data, [])).toBeNull()
  })

  it('a locked region reads "Unlocks at Lv 2 — $1,750 lifetime earned" (levels.json threshold)', () => {
    expect(dp.lockedLine(district('industrial'), data)).toBe(
      'Unlocks at Lv 2 — $1,750 lifetime earned',
    )
    // M8: the L3 threshold is a §7.6 tuning lever — read it from levels.json.
    const l3 = data.levels.find((l) => l.level === 3)!
    expect(dp.lockedLine(district('docks'), data)).toBe(
      `Unlocks at Lv 3 — $${l3.threshold.toLocaleString('en-US')} lifetime earned`,
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
    // M6 (spec-build2 §2.5): the drivers' names.
    expect(dp.homedLine(2, ['Dee', 'Pax'])).toBe(
      'Vehicles homed here: 2 (Dee, Pax)',
    )
    expect(dp.homedLine(3, ['Dee', null, 'Pax'])).toBe(
      'Vehicles homed here: 3 (Dee, Pax, no driver)',
    )
    expect(dp.homedLine(2, [null, null])).toBe(
      'Vehicles homed here: 2 (2 no driver)',
    )
    expect(dp.homedLine(0, [])).toBe('Vehicles homed here: 0')
  })
})

describe('M6 (spec-build2 §2.5): the district panel names the homed drivers', () => {
  it('homedDrivers lists the active drivers of the vehicles homed there, fleet order', () => {
    const fleet = [
      { zone: 'highres', driverName: 'Dee' },
      { zone: 'any', driverName: 'Rae' },
      { zone: 'highres', driverName: null },
      { zone: 'highres', driverName: 'Pax' },
    ]
    expect(dp.homedDrivers(fleet, 'highres')).toEqual(['Dee', null, 'Pax'])
    expect(dp.homedDrivers(fleet, 'downtown')).toEqual([])
    expect(dp.homedLine(3, dp.homedDrivers(fleet, 'highres'))).toBe(
      'Vehicles homed here: 3 (Dee, Pax, no driver)',
    )
  })
})

describe('M7 (design-m7 §6.5): the quest row', () => {
  it("takes the mood note's 28-px row (one row more only without a note); the fullest district still fits 360×604", () => {
    const base = {
      locked: false,
      satisfaction: true,
      favouredOrRule: true,
      missing: true,
      waiting: true,
    }
    const plain = dp.districtContentBottom(base)
    expect(dp.districtContentBottom({ ...base, quest: true }) - plain).toBe(28)
    const noted = dp.districtContentBottom({ ...base, moodNote: true })
    const withQuest = dp.districtContentBottom({
      ...base,
      moodNote: true,
      quest: true,
    })
    expect(withQuest).toBe(noted)
    const h = dp.districtFitHeight(withQuest, {
      H: 604,
      safeTop: 0,
      safeBottom: 0,
    })
    expect(h).toBeLessThanOrEqual(dp.districtSheetHeight(604))
  })

  it('the row is the active quest targeting the district, else its offer; none for other districts', () => {
    const sim = noOffers(makeSim(1))
    const vs = () => createViewSim(sim).quests()
    expect(dp.districtQuest(vs(), 'downtown')).toBeNull()
    const offer = offerQuest(sim, 'rush_district')
    const target = offer.target
    expect(target).not.toBeNull()
    const other = data.districts.find(
      (d) => d.kind === 'district' && d.id !== target,
    )!.id
    const q = dp.districtQuest(vs(), target!)
    expect(q?.id).toBe(offer.id)
    expect(q?.status).toBe('offered')
    expect(questRowText(q!)).toBe('Job offer: Rush hour ▸')
    expect(dp.districtQuest(vs(), other)).toBeNull()
    acceptOffer(sim)
    const a = sim.state.quests.active!
    if (a.progress.kind !== 'deliveriesFrom') throw new Error(a.progress.kind)
    a.progress.count = 4
    a.deadlineTick = sim.state.tick + 600 + 12 * 25
    const active = dp.districtQuest(vs(), target!)
    expect(active?.status).toBe('active')
    expect(questRowText(active!)).toBe(`Rush hour · 4/${a.goal} · 1d 12h`)
    expect(dp.districtQuest(vs(), other)).toBeNull()
  })

  it('an untargeted quest has no district row', () => {
    const sim = noOffers(makeSim(1))
    offerQuest(sim, 'big_haul')
    const qs = createViewSim(sim).quests()
    expect(qs.offer?.target).toBeNull()
    for (const d of data.districts)
      expect(dp.districtQuest(qs, d.id), d.id).toBeNull()
  })

  it('the active quest wins over an offer for the same district', () => {
    const sim = noOffers(makeSim(1))
    offerQuest(sim, 'rush_district')
    acceptOffer(sim)
    const a = sim.state.quests.active!
    sim.state.quests.offer = {
      ...structuredClone(a),
      id: 'q99',
      status: 'offered',
    }
    const q = dp.districtQuest(createViewSim(sim).quests(), a.target!)
    expect(q?.id).toBe(a.id)
  })

  it('its tap band is 44 px, centred on the 28-px row, full width', () => {
    expect(dp.questTapBand(100, 360)).toEqual({ x: 0, y: 92, w: 360, h: 44 })
  })
})

/** A quiet L3 sim (debugForceLevel), no spawns, funded. */
function atL3() {
  const sim = quietSim(1)
  expect(sim.dispatch({ kind: 'debugForceLevel', level: 3 }).ok).toBe(true)
  for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
  return fund(sim)
}

describe('M8 (design-m8-m9 §6.3): the overseas hub variant', () => {
  const docks = district('docks')
  if (docks.kind !== 'overseas') throw new Error('docks is not a hub')
  const handOffAt = (sim: ReturnType<typeof atL3>, dest: string) => {
    const p = injectParcel(sim, 'hr_towers_a', dest)
    p.mult = docks.valueMult
    const b = sim.state.buildings[p.origin]!
    b.waiting.splice(b.waiting.indexOf(p.id), 1)
    p.trace.push({ tick: p.spawnedTick, what: 'spawned', ref: p.origin })
    handOff(sim, null, p)
    return p
  }

  it('rows: header, pay, clearance, earned, sizes (no satisfaction, waiting or homed rows); a quest adds one', () => {
    const hub = dp.districtContentBottom({ locked: false, hub: true })
    expect(hub).toBe(16 + 28 + 28 + 3 * 28)
    expect(
      dp.districtContentBottom({ locked: false, hub: true, quest: true }),
    ).toBe(hub + 28)
    // The hub flag wins over the district rows (a hub never has them).
    expect(
      dp.districtContentBottom({
        locked: false,
        hub: true,
        satisfaction: true,
        waiting: true,
      }),
    ).toBe(hub)
    for (const H of [604, 659])
      expect(
        dp.districtFitHeight(hub + 28, { H, safeTop: 0, safeBottom: 34 }),
      ).toBeLessThanOrEqual(dp.districtSheetHeight(H))
  })

  it('the Docks from vs.hub(): "Overseas hub · pays ×1.5", "Clearance 45 s · 2 clearing · next 0:32", "Sizes: S M L XL"', () => {
    const sim = atL3()
    const vs = createViewSim(sim)
    const empty = dp.districtHubRows(vs.hub('docks'), docks, vs.tick)
    expect(empty).toEqual({
      pay: 'Overseas hub · pays ×1.5',
      clearance: `Clearance ${docks.clearanceS} s · nothing clearing`,
      sizes: 'Sizes: S M L XL',
    })
    handOffAt(sim, 'dk_pier_2')
    runTicks(sim, 130)
    handOffAt(sim, 'dk_pier_1')
    const live = createViewSim(sim)
    expect(live.districtStats('docks')?.kind).toBe('overseas')
    expect(dp.districtHubRows(live.hub('docks'), docks, live.tick)).toEqual({
      pay: 'Overseas hub · pays ×1.5',
      clearance: `Clearance ${docks.clearanceS} s · 2 clearing · next 0:32`,
      sizes: 'Sizes: S M L XL',
    })
  })

  it('the earned row is the clearances paid (District.earned)', () => {
    const sim = atL3()
    const p = handOffAt(sim, 'dk_pier_2')
    const locked = p.lockedValue!
    expect(locked).toBeGreaterThan(0)
    runTicks(sim, docks.clearanceS * 10)
    const stats = createViewSim(sim).districtStats('docks')!
    expect(stats.earned).toBe(locked)
    expect(dp.earnedLine(stats.earned)).toBe(
      `Earned here: $${locked.toLocaleString('en-US')}`,
    )
    expect(createViewSim(sim).hub('docks')?.clearing).toEqual([])
  })

  it('M9: the Airport from vs.hub() at the real L5 — "pays ×2", its 20-s clearance, "Sizes: S M"; locked before (Lv 5 line)', () => {
    const airport = district('airport')
    if (airport.kind !== 'overseas') throw new Error('airport is not a hub')
    const L5 = data.levels.find((l) => l.level === 5)!
    // M9 ships its map.hubs row: listed (not live) from the start.
    expect(createViewSim(makeSim(1)).hub('airport')?.live).toBe(false)
    expect(dp.lockedLine(airport, data)).toBe(
      `Unlocks at Lv 5 — $${L5.threshold.toLocaleString('en-US')} lifetime earned`,
    )
    const sim = quietSim(1)
    sim.state.economy.lifetimeEarned = L5.threshold
    runTicks(sim, 1)
    expect(sim.state.level.level).toBe(5)
    for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
    fund(sim)
    const vs = createViewSim(sim)
    expect(vs.hub('airport')?.live).toBe(true)
    expect(dp.districtHubRows(vs.hub('airport'), airport, vs.tick)).toEqual({
      pay: 'Overseas hub · pays ×2',
      clearance: `Clearance ${airport.clearanceS} s · nothing clearing`,
      sizes: 'Sizes: S M',
    })
    const p = injectParcel(sim, 'hr_towers_a', 'ap_cargo_hangar')
    p.mult = airport.valueMult
    const b = sim.state.buildings[p.origin]!
    b.waiting.splice(b.waiting.indexOf(p.id), 1)
    handOff(sim, null, p)
    runTicks(sim, 50)
    const live = createViewSim(sim)
    expect(live.districtStats('airport')?.kind).toBe('overseas')
    expect(
      dp.districtHubRows(live.hub('airport'), airport, live.tick).clearance,
    ).toBe(`Clearance ${airport.clearanceS} s · 1 clearing · next 0:15`)
    // A hub without a map.hubs row (a data override) still reads its
    // districts.json row, nothing clearing.
    expect(dp.districtHubRows(null, airport, 0)).toEqual({
      pay: 'Overseas hub · pays ×2',
      clearance: `Clearance ${airport.clearanceS} s · nothing clearing`,
      sizes: 'Sizes: S M',
    })
  })
})
