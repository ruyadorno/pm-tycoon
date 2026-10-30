// HUD readouts pinned to their rules: the mood face (spec §9.4), the shield
// colour (spec §6.3), the level bar and the playtest cap (spec §8, preamble;
// city-view.md §4.1), the next-unlock toast, the chips row (city-view §4.4),
// the money floats (§3.1), the speed segment (§4.3, notes §5), the Garage
// badges (§4.3), the lives row (spec §10), the follow strip text (§2, spec
// §4.6) and the news ticker queue / daily line (§8.1, spec §2).
import { describe, expect, it } from 'vitest'
import {
  chipEntries,
  ENDLESS_TAIL,
  detectionColour,
  floatsGold,
  garageAlert,
  isEarned,
  levelLabel,
  levelProgress,
  lockedRegionText,
  moneyTapText,
  moodFace,
  newlyAffordableTypes,
  nextUnlockLine,
  speedSegment,
  topLevelName,
  trendGlyph,
  cargoCounts,
  FOLLOW_PIPS_W,
  followFit,
  followModel,
  followText,
  vehicleStateText,
} from '../../src/ui/hudKit.ts'
import { lifeFrames, livesRowWidth } from '../../src/ui/LivesRow.ts'
import { wantsRotateCard } from '../../src/ui/RotateCard.ts'
import {
  dailyLine,
  TICKER_FILLER_MS,
  TICKER_PX_PER_MS,
  TICKER_QUEUE_MAX,
  TickerQueue,
} from '../../src/ui/Ticker.ts'
import { CHECK, formatMoney } from '../../src/ui/text.ts'
import { THEME } from '../../src/ui/theme.ts'
import type { VehicleSnapshot } from '../../src/sim/view-api.ts'
import type { VehicleType } from '../../src/sim/types.ts'
import { dataFixture } from '../sim/helpers.ts'

const data = dataFixture()
/** A stand-in for BitmapText width: 5 px per character. */
const measure = (s: string): number => s.length * 5

function vehicle(over: Partial<VehicleSnapshot> = {}): VehicleSnapshot {
  return {
    id: 1,
    type: 'bike',
    name: 'Bike 1',
    driverName: 'Dee',
    driverId: 2,
    driverPips: { speed: 4, energy: 3, charisma: 1 },
    driverStar: false,
    driverAffinity: 'none',
    nextDriverName: null,
    state: 'idle_lot',
    prev: { tx: 0, ty: 0 },
    cur: { tx: 0, ty: 0 },
    heading: 'se',
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

describe('spec §9.4: HUD mood face (≥ 70 happy, 40–69 neutral, < 40 angry)', () => {
  it('maps the thresholds to the three faces', () => {
    expect(moodFace(100)).toBe('ic_mood_happy')
    expect(moodFace(70)).toBe('ic_mood_happy')
    expect(moodFace(69)).toBe('ic_mood_neutral')
    expect(moodFace(40)).toBe('ic_mood_neutral')
    expect(moodFace(39)).toBe('ic_mood_angry')
    expect(moodFace(0)).toBe('ic_mood_angry')
  })

  it('spec §9.2: trend glyphs ▲ ▼ ▬', () => {
    expect(trendGlyph('up')).toBe('▲')
    expect(trendGlyph('down')).toBe('▼')
    expect(trendGlyph('flat')).toBe('▬')
  })
})

describe('spec §6.3: shield colour green ≥ 90, amber 70–89, red < 70', () => {
  it('colours the detection readout', () => {
    expect(detectionColour(97)).toBe(THEME.ok)
    expect(detectionColour(90)).toBe(THEME.ok)
    expect(detectionColour(89)).toBe(THEME.warn)
    expect(detectionColour(85)).toBe(THEME.warn)
    expect(detectionColour(70)).toBe(THEME.warn)
    expect(detectionColour(69)).toBe(THEME.danger)
  })
})

describe('spec §8 / city-view §4.1: the level bar', () => {
  it('labels the level with its levels.json title', () => {
    expect(levelLabel(data, 1)).toBe('Lv1 Scrappy')
    expect(levelLabel(data, 2)).toBe('Lv2 Local')
  })

  it('fills (lifetime − threshold[level]) / (next − threshold[level])', () => {
    const p = levelProgress(data, 1, 1240, 2000)
    expect(p.frac).toBeCloseTo(0.62, 6)
    expect(p.text).toBe('$1,240 / $2,000')
    expect(p.atCap).toBe(false)
    expect(levelProgress(data, 1, 0, 2000).frac).toBe(0)
  })

  it('at playtestMaxLevel keeps counting toward the L3 threshold with "Lv 3 coming soon"', () => {
    // The cap mechanism at the playtest-1 cap (design-m8-m9 §3.4: M8 moved
    // the shipped cap to 3; the override keeps this case).
    const capped = dataFixture({ economy: { playtestMaxLevel: 2 } })
    expect(capped.economy.playtestMaxLevel).toBe(2)
    const p = levelProgress(capped, 2, 3410, 5000)
    expect(p.atCap).toBe(true)
    expect(p.text).toBe('$3,410 / $5,000 · Lv 3 coming soon')
    expect(p.frac).toBeCloseTo((3410 - 2000) / (5000 - 2000), 6)
    // Past the threshold the bar stays full and the text keeps counting.
    const over = levelProgress(capped, 2, 5400, 5000)
    expect(over.frac).toBe(1)
    expect(over.text).toBe('$5,400 / $5,000 · Lv 3 coming soon')
    // In-game text never mentions a "next build".
    expect(p.text).not.toMatch(/build/i)
  })

  it('tap toast: the next unlock line from levels.json, "coming soon" at the cap', () => {
    const capped = dataFixture({ economy: { playtestMaxLevel: 2 } })
    expect(nextUnlockLine(capped, 1)).toBe(
      'Lv 2: Hoist Hill + trucks + Shaky shaker',
    )
    expect(nextUnlockLine(capped, 2)).toBe('Lv 3 coming soon')
  })

  it('M8 (design R1) at a cap of 3 (the M8 config): Lv 2 counts toward L3 plainly, Lv 3 reads "Lv 4 coming soon"', () => {
    const cap3 = dataFixture({ economy: { playtestMaxLevel: 3 } })
    const l3 = cap3.levels.find((l) => l.level === 3)!
    const l4 = cap3.levels.find((l) => l.level === 4)!
    // Lv 2 is below the cap: no suffix, the L3 unlocks on tap.
    const two = levelProgress(cap3, 2, 3410, l3.threshold)
    expect(two.atCap).toBe(false)
    expect(two.text).toBe(`$3,410 / ${formatMoney(l3.threshold)}`)
    expect(nextUnlockLine(cap3, 2)).toBe(
      'Lv 3: Shrinkwrap Shore + Battery checker',
    )
    // Lv 3 at the cap keeps counting toward the L4 threshold.
    const three = levelProgress(cap3, 3, 4500, l4.threshold)
    expect(three.atCap).toBe(true)
    expect(three.text).toBe(
      `$4,500 / ${formatMoney(l4.threshold)} · Lv 4 coming soon`,
    )
    expect(three.frac).toBeCloseTo(
      (4500 - l3.threshold) / (l4.threshold - l3.threshold),
      6,
    )
    const over = levelProgress(cap3, 3, 9400, l4.threshold)
    expect(over.frac).toBe(1)
    expect(over.text).toMatch(/· Lv 4 coming soon$/)
    expect(three.text).not.toMatch(/build/i)
    // M7's compact bar (quest chip showing) drops the suffix.
    expect(
      levelProgress(cap3, 3, 4500, l4.threshold, { compact: true }).text,
    ).toBe(`$4,500 / ${formatMoney(l4.threshold)}`)
    expect(nextUnlockLine(cap3, 3)).toBe('Lv 4 coming soon')
  })

  it('plan-build2 §8.2 task 11: "coming soon" vanishes by data once the cap rises (M9 ships it at the last level)', () => {
    const top = Math.max(...data.levels.map((l) => l.level))
    expect(data.economy.playtestMaxLevel).toBe(top)
    const l3 = data.levels.find((l) => l.level === 3)!
    const p = levelProgress(data, 2, 3410, l3.threshold)
    expect(p.atCap).toBe(false)
    expect(p.text).toBe(`$3,410 / ${formatMoney(l3.threshold)}`)
    expect(nextUnlockLine(data, 2)).toMatch(/^Lv 3: /)
    expect(nextUnlockLine(data, 2)).not.toMatch(/coming soon/)
    // No level of the shipped tables reads "coming soon" (bar or toast).
    for (const row of data.levels) {
      const next = data.levels.find((l) => l.level === row.level + 1)
      const bar = levelProgress(
        data,
        row.level,
        row.threshold + 100,
        next?.threshold ?? null,
      )
      expect(bar.atCap, `L${row.level}`).toBe(false)
      expect(bar.text, `L${row.level}`).not.toMatch(/coming soon/)
      expect(nextUnlockLine(data, row.level)).not.toMatch(/coming soon/)
    }
    // The top level has nothing coming: no "Lv 6 coming soon".
    expect(levelProgress(data, top, 20000, null)).toEqual({
      frac: 1,
      text: '$20,000 · Tycoon',
      atCap: false,
    })
    expect(nextUnlockLine(data, top)).toMatch(/top level$/)
  })
})

describe('M9 (design-m8-m9 §6.3, §7 M9 10): the level bar at the top level', () => {
  const top = Math.max(...data.levels.map((l) => l.level))

  it('L5 Tycoon: "$18,400 · Tycoon", "· Tycoon ✓" after the Victory; the compact bar "$18,400" / "$18,400 ✓"', () => {
    expect(top).toBe(5)
    expect(data.levels.find((l) => l.level === 5)?.title).toBe('Tycoon')
    expect(CHECK).toBe('\u2713')
    expect(levelProgress(data, 5, 18400, null)).toEqual({
      frac: 1,
      text: '$18,400 · Tycoon',
      atCap: false,
    })
    expect(levelProgress(data, 5, 18400, null, { victory: true })).toEqual({
      frac: 1,
      text: '$18,400 · Tycoon ✓',
      atCap: false,
    })
    // Beside the quest chip (M7 compact bar, 98 px at 360 — endless mode
    // keeps offering quests): the money, and the mark once won.
    expect(levelProgress(data, 5, 18400, null, { compact: true }).text).toBe(
      '$18,400',
    )
    expect(
      levelProgress(data, 5, 18400, null, { compact: true, victory: true })
        .text,
    ).toBe('$18,400 ✓')
    expect(topLevelName(data, 5, false)).toBe('Tycoon')
    expect(topLevelName(data, 5, true)).toBe('Tycoon ✓')
    // The level label left of the bar is unchanged.
    expect(levelLabel(data, 5)).toBe('Lv5 Tycoon')
  })

  it('nextUnlockLine: L3 → the L4 row, L4 → the L5 row, L5 → "Tycoon — top level" / "Tycoon ✓ — endless mode"', () => {
    expect(nextUnlockLine(data, 3)).toBe(
      'Lv 4: Semver Street + Pasture Peer Fields + X-ray + Sorter Arm',
    )
    expect(nextUnlockLine(data, 4)).toBe(
      'Lv 5: Prefetch International + Monorepo Commons',
    )
    expect(nextUnlockLine(data, 5)).toBe('Tycoon — top level')
    expect(nextUnlockLine(data, 5, true)).toBe(`Tycoon ✓ — ${ENDLESS_TAIL}`)
    expect(nextUnlockLine(data, 5, true)).toBe('Tycoon ✓ — endless mode')
    // The victory flag only matters at the top level.
    expect(nextUnlockLine(data, 4, true)).toBe(nextUnlockLine(data, 4))
  })

  it("L4 / L5 chips: the next level's regions locked with their level, none left at L5", () => {
    const lockedAt = (level: number) => {
      const live = new Set(
        data.districts.filter((d) => d.unlockLevel <= level).map((d) => d.id),
      )
      return chipEntries(data, level, (id) =>
        live.has(id) ? 'live' : 'locked',
      )
    }
    expect(lockedAt(3).filter((c) => c.lockLevel !== null)).toEqual([
      { id: 'lowres', label: 'Semver St', lockLevel: 4 },
      { id: 'rural', label: 'Rural', lockLevel: 4 },
    ])
    expect(lockedAt(4).filter((c) => c.lockLevel !== null)).toEqual([
      { id: 'airport', label: 'Airport', lockLevel: 5 },
      { id: 'civic', label: 'Commons', lockLevel: 5 },
    ])
    const five = lockedAt(5)
    expect(five.every((c) => c.lockLevel === null)).toBe(true)
    expect(five.map((c) => c.id)).toEqual(data.map.regions.map((r) => r.id))
  })
})

describe('city-view §4.1: money cell tap and floats', () => {
  it('shows lifetime earned and payroll per day', () => {
    expect(moneyTapText(1240, 28)).toBe(
      'Lifetime earned $1,240 · Payroll $28/day',
    )
  })

  it('§3.1: earnings float gold, payroll / fees / purchases float red', () => {
    for (const r of [
      'delivery',
      'clearance',
      'bounty',
      'quest',
      'refund',
    ] as const)
      expect(floatsGold(r)).toBe(true)
    for (const r of ['payroll', 'wrongToss', 'purchase', 'hire'] as const)
      expect(floatsGold(r)).toBe(false)
    // Refunds are not earnings (spec §7.3: lifetime excludes refunds).
    expect(isEarned('refund')).toBe(false)
    expect(isEarned('delivery')).toBe(true)
  })
})

describe('spec §3.5: locked region toast', () => {
  it('reads "<flavour> — unlocks at Lv N"', () => {
    expect(lockedRegionText(data, 'industrial')).toBe(
      'Hoist Hill — unlocks at Lv 2',
    )
  })
})

const live = (ids: string[]) => (id: string) =>
  ids.includes(id) ? ('live' as const) : ('locked' as const)

describe('city-view §4.4: chips row', () => {
  it('L1: HQ · Heights · Downtown · Hoist Hill 🔒Lv2', () => {
    const chips = chipEntries(
      data,
      1,
      live(['warehouse', 'highres', 'downtown']),
    )
    expect(chips.map((c) => c.label)).toEqual([
      'HQ',
      'Heights',
      'Downtown',
      'Hoist Hill',
    ])
    expect(chips.map((c) => c.lockLevel)).toEqual([null, null, null, 2])
  })

  it('L2 adds the live Hoist Hill and Docks 🔒Lv3', () => {
    const chips = chipEntries(
      data,
      2,
      live(['warehouse', 'highres', 'downtown', 'industrial']),
    )
    expect(chips.map((c) => `${c.label}:${c.lockLevel ?? ''}`)).toEqual([
      'HQ:',
      'Heights:',
      'Downtown:',
      'Hoist Hill:',
      'Docks:3',
    ])
  })
})

describe('city-view §4.3: bottom bar state', () => {
  it('speed segment: ❚❚ while paused or speed 0, else 1× / 2× (4× shows on 2×)', () => {
    expect(speedSegment(true, 1)).toBe(0)
    expect(speedSegment(false, 0)).toBe(0)
    expect(speedSegment(false, 1)).toBe(1)
    expect(speedSegment(false, 2)).toBe(2)
    expect(speedSegment(false, 4)).toBe(2)
  })

  it('Garage "!" while a driver is unpaid or a vehicle is inactive', () => {
    expect(garageAlert([vehicle()])).toBe(false)
    expect(garageAlert([vehicle(), vehicle({ id: 2, unpaid: true })])).toBe(
      true,
    )
    expect(garageAlert([vehicle({ state: 'inactive' })])).toBe(true)
  })

  it('Garage "+" once, when a newly unlocked type becomes affordable', () => {
    const seen = new Set<VehicleType>(['bike', 'van'])
    expect(newlyAffordableTypes(data, 1, 5000, seen)).toEqual([])
    const truck = data.vehicles.types.find((t) => t.id === 'truck')!.price
    expect(newlyAffordableTypes(data, 2, truck - 1, seen)).toEqual([])
    expect(newlyAffordableTypes(data, 2, truck, seen)).toEqual(['truck'])
    seen.add('truck')
    expect(newlyAffordableTypes(data, 2, 9999, seen)).toEqual([])
  })
})

describe('spec §10: lives row (start 3, cap 5)', () => {
  it('fills one slot per life, the rest are outlines', () => {
    expect(lifeFrames(3)).toEqual([
      'ic_life_on',
      'ic_life_on',
      'ic_life_on',
      'ic_life_off',
      'ic_life_off',
    ])
    expect(lifeFrames(0).every((f) => f === 'ic_life_off')).toBe(true)
    expect(lifeFrames(9).every((f) => f === 'ic_life_on')).toBe(true)
    expect(livesRowWidth()).toBe(5 * 16 + 4 * 2)
  })
})

describe('city-view §2 / spec §4.6: follow strip text', () => {
  it('reads "Bike 1 · Dee · Delivering · 2 stops"', () => {
    expect(followText(vehicle({ state: 'delivering', stopsLeft: 2 }))).toBe(
      'Bike 1 · Dee · Delivering · 2 stops',
    )
    expect(followText(vehicle({ state: 'delivering', stopsLeft: 1 }))).toBe(
      'Bike 1 · Dee · Delivering · 1 stop',
    )
  })

  it('names every §4.6 state', () => {
    const t = (over: Partial<VehicleSnapshot>) =>
      vehicleStateText(vehicle(over))
    expect(t({ state: 'idle_lot' })).toBe('Idle')
    expect(t({ state: 'collecting' })).toBe('Collecting')
    expect(t({ state: 'returning' })).toBe('Returning')
    expect(t({ state: 'queued', queuePos: 1 })).toBe('Queued #2')
    expect(t({ state: 'docked_unloading' })).toBe('Unloading')
    expect(t({ state: 'docked_loading' })).toBe('Loading')
    expect(t({ state: 'inactive' })).toBe('No driver')
    expect(followText(vehicle({ state: 'inactive', driverName: null }))).toBe(
      'Bike 1 · No driver',
    )
  })

  it('M6: "Bike 1 · Dee ●●●●○ · Delivering" — the driver\'s speed pips after the name', () => {
    expect(followModel(vehicle({ state: 'delivering' }))).toEqual({
      head: 'Bike 1 · Dee',
      pips: 4,
      tail: '· Delivering',
    })
    expect(
      followModel(vehicle({ state: 'delivering', stopsLeft: 2 })).tail,
    ).toBe('· Delivering · 2 stops')
    // No active driver: no pips, the "No driver" line.
    expect(
      followModel(vehicle({ state: 'inactive', driverName: null })),
    ).toEqual({ head: 'Bike 1 · No driver', pips: null, tail: '' })
    expect(followModel(vehicle({ driverPips: null })).pips).toBeNull()
  })

  it('M6: a long line ellipsizes the state first, then drops the pips', () => {
    const m = followModel(vehicle({ state: 'delivering', stopsLeft: 2 }))
    const headW = measure(m.head)
    const all = followFit(m, 1000, measure)
    expect(all).toEqual({ head: m.head, pips: true, tail: m.tail })
    const short = followFit(m, headW + FOLLOW_PIPS_W + 40, measure)
    expect(short.pips).toBe(true)
    expect(short.tail.endsWith('…')).toBe(true)
    expect(measure(short.tail)).toBeLessThanOrEqual(40)
    // Only "· …" would be left: the tail goes.
    expect(followFit(m, headW + FOLLOW_PIPS_W + 12, measure).tail).toBe('')
    const tiny = followFit(m, headW + 10, measure)
    expect(tiny.pips).toBe(false)
    expect(tiny.tail).toBe('')
    expect(measure(tiny.head)).toBeLessThanOrEqual(headW + 10)
    // Without pips (no driver, or no pip frames) the line is one ellipsized text.
    const none = followFit({ ...m, pips: null }, 60, measure)
    expect(none.pips).toBe(false)
    expect(measure(none.head)).toBeLessThanOrEqual(60)
  })

  it('groups cargo by size in S, M, L, XL order', () => {
    const cargo = [
      { id: 1, size: 'M' as const, destId: 'a' },
      { id: 2, size: 'S' as const, destId: 'a' },
      { id: 3, size: 'S' as const, destId: 'b' },
      { id: 4, size: 'S' as const, destId: 'b' },
    ]
    expect(cargoCounts(cargo)).toEqual([
      { size: 'S', n: 3 },
      { size: 'M', n: 1 },
    ])
  })
})

describe('city-view §8.1: news ticker queue (max 8, FIFO, dedupe)', () => {
  it('scrolls at 40 px/s and fills after 90 s of silence', () => {
    expect(TICKER_PX_PER_MS * 1000).toBe(40)
    expect(TICKER_FILLER_MS).toBe(90_000)
    expect(TICKER_QUEUE_MAX).toBe(8)
  })

  it('is FIFO and drops identical text that is waiting or scrolling', () => {
    const q = new TickerQueue()
    expect(q.push({ text: 'a', kind: 'level' })).toBe('queued')
    expect(q.push({ text: 'b', kind: 'mood' })).toBe('queued')
    expect(q.push({ text: 'a', kind: 'level' })).toBe('duplicate')
    expect(q.next()?.text).toBe('a')
    expect(q.push({ text: 'a', kind: 'level' })).toBe('duplicate')
    expect(q.next()?.text).toBe('b')
    expect(q.next()).toBeNull()
    expect(q.push({ text: 'a', kind: 'level' })).toBe('queued')
  })

  it('keeps at most 8 waiting lines, dropping the oldest', () => {
    const q = new TickerQueue()
    for (let i = 0; i < 10; i++) q.push({ text: `line ${i}`, kind: 'filler' })
    expect(q.waiting.length).toBe(8)
    expect(q.next()?.text).toBe('line 2')
  })

  it('spec §2: the daily summary line', () => {
    expect(dailyLine(3, 14, 312, 28)).toBe(
      'Day 3: 14 delivered, $312 earned, payroll $28',
    )
    expect(dailyLine(1, 4, 96, 0)).toBe('Day 1: 4 delivered, $96 earned')
  })

  it("M8: the day's paid overseas clearances follow the deliveries (none → unchanged)", () => {
    expect(dailyLine(9, 14, 412, 28, 3)).toBe(
      'Day 9: 14 delivered, 3 cleared overseas, $412 earned, payroll $28',
    )
    expect(dailyLine(9, 14, 412, 0, 0)).toBe('Day 9: 14 delivered, $412 earned')
  })
})

describe('decision #4: the rotate card on a phone in landscape', () => {
  it('asks phones in landscape only', () => {
    expect(wantsRotateCard(852, 393, false)).toBe(true)
    expect(wantsRotateCard(393, 659, false)).toBe(false)
    expect(wantsRotateCard(852, 393, true)).toBe(false)
  })
})
