// Run decision Q-RUN1 / spec §4.6 "with one dock the cycle cannot deadlock"
// (+ §6.4 nothing dropped): randomized soak of the single L1-L2 loading dock.
// Each seed is a random fleet with random home zones, a shelf at its cap
// (mostly with parcels the fleet cannot carry yet), parcels in the lane and
// waiting in the city, a Toss-everything player, then a random capability
// event (zones → any / a truck / a van / a bike / nothing). Afterwards,
// whenever some vehicle could carry a shelf parcel: the oldest carriable
// shelf parcels get loaded, and no vehicle stays docked > 120 s while the
// shelf is drainable; conservation holds throughout (tests/sim/soak.ts).
//
// The default count keeps `vlr check` fast; PM_SOAK=<n> runs n seeds (the
// M2 review ran 3,000: `PM_SOAK=3000 vitest run tests/sim/dock-soak.test.ts`).

import { describe, expect, it } from 'vitest'
import { soakScenario } from './soak.ts'

const SEEDS = Number(globalThis.process?.env?.PM_SOAK ?? '') || 60

describe('Q-RUN1 one loading dock never deadlocks (spec §4.6, §6.4)', () => {
  it(`${SEEDS} random fleets × zones × full shelves × capability events: the dock keeps turning over and the shelf drains once a vehicle can carry it`, () => {
    const failures: string[] = []
    const events: Record<string, number> = {}
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = soakScenario(seed)
      events[r.event] = (events[r.event] ?? 0) + 1
      if (r.failure !== null) failures.push(`seed ${seed}: ${r.failure}`)
    }
    expect(failures).toEqual([])
    // the generator really exercises the jam and every capability event
    expect(Object.keys(events).toSorted()).toEqual(
      ['buy bike', 'buy truck', 'buy van', 'none', 'zones→any'].toSorted(),
    )
  }, 600_000)
})
