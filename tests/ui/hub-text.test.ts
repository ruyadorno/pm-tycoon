// M8 overseas hubs on the HUD side (spec-core §5.6, spec-build2 §4.1;
// design-m8-m9 §6.3): the building tooltip's hub part (pier / terminal tag,
// the clearance line, the port office), the tag joining the name only when
// it fits the 200-px tooltip in m5x7, the vessel wording (ship / plane,
// design R11), the dock-bought toast — read from a real Sim's vs.hubs()
// where it matters; M9: the Airport's map.hubs row (a plane) and the live
// Airport's terminal / hangar at the real L5. hubText.ts is pure: no Phaser
// stub needed.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Sim } from '../../src/sim/sim.ts'
import { handOff } from '../../src/sim/systems/hubs.ts'
import type { Parcel } from '../../src/sim/types.ts'
import type { HubView } from '../../src/sim/view-api.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  dockBoughtToast,
  hubIcon,
  hubTip,
  hubTipRows,
  isPlaneHub,
  multText,
  nextClearS,
  OFFICE_LABEL,
  sailedText,
} from '../../src/ui/hubText.ts'
import {
  collect,
  dataFixture,
  fund,
  injectParcel,
  quietSim,
  runTicks,
} from '../sim/helpers.ts'

const data = dataFixture()
const building = (id: string) => {
  const b = data.buildings.find((x) => x.id === id)
  if (!b) throw new Error(id)
  return b
}
const docks = data.districts.find((d) => d.id === 'docks')!
if (docks.kind !== 'overseas') throw new Error('docks is not a hub')

/** m5x7 advance widths (src/assets/m5x7.xml). */
const adv = new Map<number, number>()
for (const m of readFileSync(
  new URL('../../src/assets/m5x7.xml', import.meta.url),
  'utf8',
).matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
  adv.set(Number(m[1]), Number(m[2]))
const width = (s: string): number =>
  [...s].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 6), 0)
/** BuildingTooltip: TOOLTIP_MAX_W 200, PAD 6 each side. */
const TIP_INNER = 200 - 2 * 6
const fits = (row: string): boolean => width(row) <= TIP_INNER

/** `n` S parcels handed off at `b`, `clearS` seconds of clearance left at tick 0. */
const many = (n: number, b: string, clearS: number) =>
  Array.from({ length: n }, (_, i) => ({
    parcelId: i + 1,
    buildingId: b,
    size: 'S' as const,
    handOffTick: 0,
    clearTick: clearS * 10,
    lockedValue: 1,
  }))

const vessel = (frame: string) => ({
  frame,
  tile: [0, 0],
  exit: [1, 0],
  liftPx: 0,
})

/** A quiet L3 sim (debugForceLevel), no spawns, funded. */
function atL3(seed = 1): Sim {
  const sim = quietSim(seed)
  expect(sim.dispatch({ kind: 'debugForceLevel', level: 3 }).ok).toBe(true)
  for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
  return fund(sim)
}

/** Hand a fresh S parcel off at `dest` now (no vehicle). */
function handOffAt(sim: Sim, dest: string): Parcel {
  const p = injectParcel(sim, 'hr_towers_a', dest)
  p.mult = docks.kind === 'overseas' ? docks.valueMult : 1
  const b = sim.state.buildings[p.origin]!
  b.waiting.splice(b.waiting.indexOf(p.id), 1)
  p.trace.push({ tick: p.spawnedTick, what: 'spawned', ref: p.origin })
  handOff(sim, null, p)
  return p
}

describe('design-m8-m9 §6.3: the building tooltip of a hub', () => {
  it('a pier counts its own hand-offs, the port office the whole hub (vs.hubs() of a real L3 sim)', () => {
    const sim = atL3()
    handOffAt(sim, 'dk_pier_2')
    runTicks(sim, 130)
    handOffAt(sim, 'dk_pier_2')
    runTicks(sim, 60)
    handOffAt(sim, 'dk_pier_1')
    const vs = createViewSim(sim)
    const hubs = vs.hubs()
    // Every map.hubs row in order, live or not (M9 ships the Airport's row;
    // at L3 it is locked with nothing clearing).
    expect(hubs.map((h) => [h.id, h.live])).toEqual([
      ['docks', true],
      ['airport', false],
    ])
    expect(hubs[0]!.clearing).toHaveLength(3)
    expect(hubs[1]!.clearing).toEqual([])
    const tick = vs.tick
    // Pier 2: two clearing, the first handed off 190 ticks ago → 26 s left.
    expect(hubTip(hubs, building('dk_pier_2'), tick)).toEqual({
      tag: 'overseas ×1.5',
      line: '2 clearing · next 0:26',
    })
    // Pier 1: its own parcel only, just handed off.
    expect(hubTip(hubs, building('dk_pier_1'), tick)).toEqual({
      tag: 'overseas ×1.5',
      line: '1 clearing · next 0:45',
    })
    // The port office (recv 0): the hub's three, the soonest first.
    expect(hubTip(hubs, building('dk_customs'), tick)).toEqual({
      tag: null,
      line: `${OFFICE_LABEL} · 3 clearing · next 0:26`,
    })
    // Not a hub building.
    expect(hubTip(hubs, building('hr_towers_a'), tick)).toBeNull()
  })

  it('nothing clearing: the pier says how long a clearance takes, the office "nothing clearing"', () => {
    const vs = createViewSim(atL3())
    const hubs = vs.hubs()
    expect(hubTip(hubs, building('dk_pier_1'), vs.tick)).toEqual({
      tag: 'overseas ×1.5',
      line: `Clears in ${docks.clearanceS} s`,
    })
    expect(hubTip(hubs, building('dk_customs'), vs.tick)?.line).toBe(
      'Port office · nothing clearing',
    )
  })

  it('an office that also receives (the Airport terminal) shows the tag and the hub-wide count', () => {
    const airport: HubView = {
      id: 'airport',
      live: true,
      office: 'ap_terminal',
      clearanceS: 20,
      valueMult: 2,
      sizes: ['S', 'M'],
      clearing: [
        {
          parcelId: 1,
          buildingId: 'ap_cargo_hangar',
          size: 'S',
          handOffTick: 0,
          clearTick: 200,
          lockedValue: 40,
        },
        {
          parcelId: 2,
          buildingId: 'ap_terminal',
          size: 'M',
          handOffTick: 80,
          clearTick: 280,
          lockedValue: 60,
        },
      ],
      earned: 0,
    }
    expect(hubTip([airport], building('ap_terminal'), 80)).toEqual({
      tag: 'overseas ×2',
      line: '2 clearing · next 0:12',
    })
    expect(hubTip([airport], building('ap_cargo_hangar'), 80)).toEqual({
      tag: 'overseas ×2',
      line: '1 clearing · next 0:12',
    })
  })

  it('the tag joins the name when the row fits the 200-px tooltip, else it leads the hub line', () => {
    const tip = { tag: 'overseas ×1.5', line: '1 clearing · next 0:32' }
    expect(hubTipRows('Prefetch Pier 2', tip, fits)).toEqual({
      name: 'Prefetch Pier 2 · overseas ×1.5',
      line: '1 clearing · next 0:32',
      extra: null,
    })
    const ap = { tag: 'overseas ×2', line: '2 clearing · next 0:12' }
    expect(hubTipRows('Prefetch International Terminal', ap, fits)).toEqual({
      name: 'Prefetch International Terminal',
      line: 'overseas ×2 · 2 clearing · next 0:12',
      extra: null,
    })
    // Neither fits (a two-digit count at the long-named terminal): the tag
    // gets a row of its own.
    const busy = { tag: 'overseas ×2', line: '12 clearing · next 0:20' }
    expect(hubTipRows('Prefetch International Terminal', busy, fits)).toEqual({
      name: 'Prefetch International Terminal',
      line: '12 clearing · next 0:20',
      extra: 'overseas ×2',
    })
    // The office has no tag: its name stays as it is.
    const office = { tag: null, line: 'Port office · nothing clearing' }
    expect(hubTipRows('Shrinkwrap Customs House', office, fits)).toEqual({
      name: 'Shrinkwrap Customs House',
      line: 'Port office · nothing clearing',
      extra: null,
    })
  })

  it('every hub row of every hub building fits the tooltip in m5x7 (1–12 clearing, the full clearance left)', () => {
    for (const d of data.districts) {
      if (d.kind !== 'overseas') continue
      const office =
        data.map.hubs.find((h) => h.district === d.id)?.office ??
        data.buildings.find((b) => b.district === d.id)!.id
      for (const b of data.buildings.filter((x) => x.district === d.id)) {
        for (const n of [0, 1, 9, 12]) {
          const hub: HubView = {
            id: d.id,
            live: true,
            office,
            clearanceS: d.clearanceS,
            valueMult: d.valueMult,
            sizes: d.sizes,
            clearing: many(n, b.id, d.clearanceS),
            earned: 0,
          }
          const tip = hubTip([hub], b, 0)!
          const rows = hubTipRows(b.name, tip, fits)
          for (const row of [rows.name, rows.line, rows.extra ?? '']) {
            // A plain building name is the existing tooltip's row 1.
            if (row === b.name) continue
            expect(width(row), `${b.id} ×${n}: ${row}`).toBeLessThanOrEqual(
              TIP_INNER,
            )
          }
        }
      }
    }
  })

  it('nextClearS: the soonest clearTick (per building or hub-wide), never negative; null when none', () => {
    const c = [
      {
        parcelId: 1,
        buildingId: 'dk_pier_1',
        size: 'S' as const,
        handOffTick: 0,
        clearTick: 450,
        lockedValue: 1,
      },
      {
        parcelId: 2,
        buildingId: 'dk_pier_2',
        size: 'S' as const,
        handOffTick: 100,
        clearTick: 550,
        lockedValue: 1,
      },
    ]
    expect(nextClearS(c, 130)).toBe(32)
    expect(nextClearS(c, 130, 'dk_pier_2')).toBe(42)
    expect(nextClearS(c, 600)).toBe(0)
    expect(nextClearS(c, 0, 'dk_customs')).toBeNull()
    expect(nextClearS([], 0)).toBeNull()
  })
})

describe('M9 (design-m8-m9 §6.3, B2 §4.3): the live Airport at the real L5', () => {
  const airport = data.districts.find((d) => d.id === 'airport')!
  if (airport.kind !== 'overseas') throw new Error('airport is not a hub')

  /** A quiet game at L5 the levels.json way (lifetime earned, the shipped cap), funded. */
  function atL5(seed = 1): Sim {
    const sim = quietSim(seed)
    const L5 = data.levels.find((l) => l.level === 5)!
    sim.state.economy.lifetimeEarned = L5.threshold
    runTicks(sim, 1)
    expect(sim.state.level.level).toBe(5)
    for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
    return fund(sim)
  }

  /** Hand a fresh S parcel off at the Airport building `dest` now (no vehicle). */
  function handOffAirport(sim: Sim, dest: string): Parcel {
    const p = injectParcel(sim, 'hr_towers_a', dest)
    p.mult = airport.kind === 'overseas' ? airport.valueMult : 1
    const b = sim.state.buildings[p.origin]!
    b.waiting.splice(b.waiting.indexOf(p.id), 1)
    p.trace.push({ tick: p.spawnedTick, what: 'spawned', ref: p.origin })
    handOff(sim, null, p)
    return p
  }

  it('both hubs live; the terminal (the office, receiving) shows the tag and the hub-wide count, the hangar its own', () => {
    const sim = atL5()
    expect(
      createViewSim(sim)
        .hubs()
        .map((h) => [h.id, h.live]),
    ).toEqual([
      ['docks', true],
      ['airport', true],
    ])
    // Nothing clearing: the clearance time (20 s at the Airport).
    let hubs = createViewSim(sim).hubs()
    expect(hubTip(hubs, building('ap_cargo_hangar'), sim.state.tick)).toEqual({
      tag: 'overseas ×2',
      line: `Clears in ${airport.clearanceS} s`,
    })
    handOffAirport(sim, 'ap_cargo_hangar')
    runTicks(sim, 80)
    handOffAirport(sim, 'ap_terminal')
    const vs = createViewSim(sim)
    hubs = vs.hubs()
    expect(hubs[1]!.clearing).toHaveLength(2)
    expect(hubTip(hubs, building('ap_terminal'), vs.tick)).toEqual({
      tag: 'overseas ×2',
      line: '2 clearing · next 0:12',
    })
    expect(hubTip(hubs, building('ap_cargo_hangar'), vs.tick)).toEqual({
      tag: 'overseas ×2',
      line: '1 clearing · next 0:12',
    })
    // The long-named terminal: the tag leads the second row (200-px tooltip).
    const rows = hubTipRows(
      building('ap_terminal').name,
      hubTip(hubs, building('ap_terminal'), vs.tick)!,
      fits,
    )
    expect(rows).toEqual({
      name: 'Prefetch International Terminal',
      line: 'overseas ×2 · 2 clearing · next 0:12',
      extra: null,
    })
  })
})

describe('design R11: ship or plane', () => {
  it('the Docks sail a ship; the Airport (its map.hubs row since M9: ap_plane) flies a plane', () => {
    expect(
      data.map.hubs.find((h) => h.district === 'airport')?.vessel,
    ).toMatchObject({
      frame: 'ap_plane',
    })
    expect(sailedText(data, 'docks')).toBe('the ship has sailed')
    expect(sailedText(data, 'airport')).toBe('the plane has left')
    expect(hubIcon(data, 'docks')).toBe('ic_ship')
    expect(hubIcon(data, 'airport')).toBe('ic_plane')
    expect(isPlaneHub(data, null)).toBe(false)
    // A hub without a map.hubs row (a data override) falls back on its id.
    const bare = { map: { hubs: [] } } as unknown as Pick<typeof data, 'map'>
    expect(sailedText(bare, 'airport')).toBe('the plane has left')
    expect(sailedText(bare, 'docks')).toBe('the ship has sailed')
  })

  it('a map.hubs row decides by its vessel frame', () => {
    const map = {
      hubs: [
        {
          district: 'airport',
          office: 'ap_terminal',
          vessel: vessel('ap_plane'),
        },
        { district: 'docks', office: 'dk_customs', vessel: vessel('dk_ship') },
      ],
    } as unknown as Pick<typeof data.map, 'hubs'>
    expect(sailedText({ map }, 'airport')).toBe('the plane has left')
    expect(sailedText({ map }, 'docks')).toBe('the ship has sailed')
  })

  it('multipliers read ×1.5 / ×2', () => {
    expect(multText(1.5)).toBe('×1.5')
    expect(multText(2)).toBe('×2')
    expect(multText(docks.valueMult)).toBe('×1.5')
  })
})

describe('design-m8-m9 §6.3: the dock-bought toast', () => {
  it('"Loading dock 2 open — two vehicles unload at once" (the count is the docks owned after the buy)', () => {
    expect(dockBoughtToast(2, 2)).toBe(
      'Loading dock 2 open — two vehicles unload at once',
    )
    expect(dockBoughtToast(3, 3)).toBe(
      'Loading dock 3 open — three vehicles unload at once',
    )
    // Dock 3 bought before dock 2 (design R8): still two docks.
    expect(dockBoughtToast(3, 2)).toBe(
      'Loading dock 3 open — two vehicles unload at once',
    )
  })

  it('a real buyDock emits dock:bought with the index the toast reads', () => {
    const sim = atL3()
    const events = collect(sim, 'dock:bought')
    expect(createViewSim(sim).lane.buyDock(2).ok).toBe(true)
    expect(events).toEqual([{ index: 2, dockId: 'dock2' }])
    expect(dockBoughtToast(events[0]!.index, sim.state.lane.docks.length)).toBe(
      'Loading dock 2 open — two vehicles unload at once',
    )
  })
})
