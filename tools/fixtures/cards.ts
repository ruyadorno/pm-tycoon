// Event cards in the fixture runs (build 3, M11 critique 12). A card holds a
// sim with no policy attached (B3 §6), so every fixture script:
//   - after a policy run (before dispose, before a snapshot): settleCards —
//     a card opened on the last tick gets one more policy step (the
//     competent policy answers cards first; logged commands, still a plain
//     run);
//   - ticks a policy-less sim with plainTick — an open card is answered with
//     its default option through a logged `decideEvent` (replayable), and a
//     tick that does not advance throws instead of hanging;
//   - asserts assertNoCard before writing a snapshot.
// The critique's `nextDrawTick = DECK_OFF_TICK` patch after dispose is not
// used: it is state patching, and tests/data/shot-fixtures.test.ts replays
// every plain fixture to the same state hash.

import type { Policy, Sim } from '../../src/sim/sim.ts'
import { cardOptions } from '../../src/sim/systems/deck.ts'

/** A card opened on the policy run's last tick is answered by one more step. */
export function settleCards(sim: Sim, policy: Policy): void {
  if (sim.state.events.open !== null) policy.step()
}

/** Answer an open card with its default (else first) visible, affordable option. */
export function answerDefault(sim: Sim): void {
  const open = sim.state.events.open
  if (open === null) return
  const opts = cardOptions(sim, open).filter((o) => o.visible && o.affordable)
  const pick = opts.find((o) => o.default) ?? opts[0]
  if (pick === undefined)
    throw new Error(`fixture: card ${open.eventId} has no answerable option`)
  const r = sim.dispatch({
    kind: 'decideEvent',
    eventId: open.eventId,
    option: pick.index,
  })
  if (!r.ok && r.applied !== true)
    throw new Error(`fixture: decideEvent ${open.eventId}: ${r.reason}`)
}

/** One tick of a policy-less sim: answer a card first; never a silent hold. */
export function plainTick(sim: Sim): void {
  answerDefault(sim)
  const before = sim.state.tick
  sim.tick()
  if (sim.state.tick === before)
    throw new Error(`fixture: the sim is held at tick ${before}`)
}

/** No fixture snapshot holds an open card. */
export function assertNoCard(sim: Sim, what: string): void {
  const open = sim.state.events.open
  if (open !== null)
    throw new Error(`${what}: card ${open.eventId} is open at the snapshot`)
}
