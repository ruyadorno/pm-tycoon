// Review deck-1 (M11 interim, D-18; B3 §3.5 the rescue, §6 the hold): the M11
// HUD draws only job cards, so an open deck card that is not a job card — the
// rescue's loaner opens with SIM_FEATURES.events off, and so does any
// debug.offerEvent card — would hold a policy-less sim with nothing on
// screen. HudScene answers it with interimCardAnswer (its default option when
// shown and affordable, else the first affordable one) through
// ViewSim.event.decide and tickers `<title>: <lines>`. Here on Node: the
// player who kits out the lane before buying a bike (deck on, no policy,
// every job card declined) meets the loaner, the sim holds, the interim
// answer releases it — a bike with Mo at the wheel, the ticks run again, the
// replay of the log matches; job cards and no card give no answer.

import { describe, expect, it } from 'vitest'
import { replay, Sim, stateHash } from '../../src/sim/sim.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import type { OpenCardView } from '../../src/sim/view-api.ts'
import { interimCardAnswer } from '../../src/ui/questText.ts'
import { dataFixture } from '../sim/helpers.ts'

const data = dataFixture()

/** A fresh browser-default game (the deck on, no policy) that spends its start money on the lane. */
function laneFirst(seed: number): Sim {
  const sim = new Sim(data, seed)
  const s = sim.state
  const slot = s.lane.nodes.find((n) => n.kind === 'slot' && n.fixture === null)
  if (!slot) throw new Error('no free slot')
  const md = sim.dispatch({
    kind: 'buyMachine',
    defId: 'metal_detector',
    nodeId: slot.id,
  })
  if (!md.ok) throw new Error(`detector: ${md.reason}`)
  const desk = s.lane.nodes.find((n) => n.fixture?.kind === 'desk')
  const a = s.applicants.inspector[0]
  if (desk && a) {
    sim.dispatch({
      kind: 'hire',
      role: 'inspector',
      applicantId: a.id,
      target: { nodeId: desk.id },
    })
  }
  return sim
}

describe('the M11 interim answer to a non-job card (review deck-1)', () => {
  it('deck on, no policy, fleet 0 and the balance below a bike: the loaner holds the sim; the interim answer takes it and the game runs on', () => {
    const sim = laneFirst(1)
    const s = sim.state
    const vs = createViewSim(sim)
    const bike = data.vehicles.types.find((t) => t.id === 'bike')!
    expect(s.vehicles).toHaveLength(0)
    expect(sim.policyAttached).toBe(false)
    // Play on as a human who declines every job card, until another card opens.
    for (let i = 0; i < 20_000; i++) {
      const o = s.events.open
      if (o?.kind === 'job') {
        expect(vs.quest.decline(o.questId!).ok).toBe(true)
      } else if (o !== null) break
      sim.tick()
    }
    expect(s.events.open?.eventId).toBe('ev_luck_loaner')
    expect(s.economy.balance).toBeLessThan(bike.price)
    // The hold: tick() is a no-op while it is up.
    expect(sim.held).toBe(true)
    const at = s.tick
    for (let i = 0; i < 100; i++) sim.tick()
    expect(s.tick).toBe(at)
    // The HUD's interim answer.
    const a = interimCardAnswer(vs.events().open)
    expect(a).not.toBeNull()
    expect(a!.eventId).toBe('ev_luck_loaner')
    expect(a!.line.startsWith('The loaner: ')).toBe(true)
    expect(vs.event.decide(a!.eventId, a!.index).ok).toBe(true)
    expect(sim.held).toBe(false)
    expect(s.events.open).toBeNull()
    expect(s.vehicles).toHaveLength(1)
    const mo = s.employees.find((e) => e.id === s.vehicles[0]!.driverId)
    expect(mo?.name).toBe('Mo')
    // Playing on (job cards declined, any other card answered as above —
    // the next draw was due on the loaner's tick), the game never stays held.
    for (let i = 0; i < 6000; i++) {
      const o = s.events.open
      if (o?.kind === 'job') vs.quest.decline(o.questId!)
      else if (o !== null) {
        const b = interimCardAnswer(vs.events().open)!
        expect(vs.event.decide(b.eventId, b.index).ok).toBe(true)
      }
      sim.tick()
    }
    expect(s.tick).toBe(at + 6000)
    // The answer is a logged command: the replay reproduces the run.
    expect(
      sim.commandLog.some(
        (e) => e.cmd.kind === 'decideEvent' && e.cmd.eventId === a!.eventId,
      ),
    ).toBe(true)
    const again = replay(data, s.seed, sim.commandLog, s.tick)
    expect(stateHash(again.state)).toBe(stateHash(s))
  })

  it('a debug card (debug.offerEvent) is answered the same way: the default when affordable, else the first affordable option', () => {
    const sim = new Sim(data, 2)
    const vs = createViewSim(sim, { debug: true })
    sim.state.level.level = 2
    sim.state.economy.balance = 1000
    expect(vs.debug!.offerEvent('ev_sec_recall').ok).toBe(true)
    const open = vs.events().open!
    const a = interimCardAnswer(open)
    const def = open.options.find((o) => o.default)!
    expect(a?.index).toBe(def.index)
    expect(a?.line).toBe(
      `${open.title}: ${def.lines.map((l) => l.text).join(', ')}`,
    )
    // A default the balance cannot pay: the first affordable option instead.
    const greyed: OpenCardView = {
      ...open,
      options: open.options.map((o) =>
        o.default ? { ...o, affordable: false } : o,
      ),
    }
    const b = interimCardAnswer(greyed)
    expect(b?.index).toBe(open.options.find((o) => !o.default)!.index)
    // Nothing affordable: no answer (the card stays up).
    expect(
      interimCardAnswer({
        ...open,
        options: open.options.map((o) => ({ ...o, affordable: false })),
      }),
    ).toBeNull()
  })

  it('no answer for no card or a job card (the QuestCard answers those)', () => {
    expect(interimCardAnswer(null)).toBeNull()
    const sim = new Sim(data, 3)
    const vs = createViewSim(sim, { debug: true })
    expect(vs.debug!.offerQuest('rush_district').ok).toBe(true)
    const open = vs.events().open
    expect(open?.kind).toBe('job')
    expect(interimCardAnswer(open)).toBeNull()
  })
})
