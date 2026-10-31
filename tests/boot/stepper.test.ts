// Review deck-2 (B3 §3.2, §6 the hold; plan.md §6.5 the stepper): while the
// sim is held (a card open, no policy) the browser stepper runs no tick —
// frame() leaves the accumulator and registry 'alpha' as they were, so a
// moving vehicle (VehicleView lerps prev → cur by alpha) stands still instead
// of replaying its last 100 ms step at 10 Hz; a frame or an advance stops at
// the tick that opened the card; `ticks` counts only the ticks that ran; the
// hold released, frames run again. Phaser is mocked (only the STEP event
// name is read); the game is a stub with an event bus and a registry.

import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({
  default: { Core: { Events: { STEP: 'step' } } },
}))

const { installStepper, REG_ALPHA, TICK_MS } =
  await import('../../src/boot/stepper.ts')
const { Sim } = await import('../../src/sim/sim.ts')
const { createPolicy } = await import('../../src/sim/policy.ts')
const { dataFixture, makeSim } = await import('../sim/helpers.ts')

type Listener = (time: number, delta: number) => void

/** The two Phaser.Game members the stepper uses. */
function stubGame(): {
  game: Parameters<typeof installStepper>[0]
  reg: Map<string, unknown>
  step: (delta: number) => void
} {
  const reg = new Map<string, unknown>()
  const on = new Set<Listener>()
  const game = {
    registry: { set: (k: string, v: unknown) => reg.set(k, v) },
    events: {
      on: (_n: string, f: Listener) => on.add(f),
      off: (_n: string, f: Listener) => on.delete(f),
    },
  } as unknown as Parameters<typeof installStepper>[0]
  return { game, reg, step: (d) => on.forEach((f) => f(0, d)) }
}

/** A Tickable whose hold the test flips. */
function fakeSim(): { tick(): void; held: boolean; ticks: number } {
  return {
    held: false,
    ticks: 0,
    tick() {
      if (!this.held) this.ticks += 1
    },
  }
}

describe('the stepper through a sim hold (review deck-2)', () => {
  it('held: frames run no tick and leave the accumulator and alpha untouched; released, they run again', () => {
    const { game, reg, step } = stubGame()
    const sim = fakeSim()
    const st = installStepper(game, sim)
    step(150) // one tick, acc 50
    expect(sim.ticks).toBe(1)
    expect(st.ticks).toBe(1)
    expect(reg.get(REG_ALPHA)).toBeCloseTo(0.5)
    sim.held = true
    for (let i = 0; i < 30; i++) step(16)
    expect(sim.ticks).toBe(1)
    expect(st.ticks).toBe(1)
    expect(st.alpha).toBeCloseTo(0.5)
    expect(reg.get(REG_ALPHA)).toBeCloseTo(0.5)
    expect(st.advance(1000)).toBe(0)
    expect(st.ticks).toBe(1)
    sim.held = false
    step(60) // acc 110 → one tick, acc 10
    expect(sim.ticks).toBe(2)
    expect(reg.get(REG_ALPHA)).toBeCloseTo(10 / TICK_MS)
    st.destroy()
  })

  it('a card opening inside a frame stops it at that tick (the rest of the frame runs nothing)', () => {
    const { game } = stubGame()
    const sim = fakeSim()
    const st = installStepper(game, sim)
    const tick = sim.tick.bind(sim)
    sim.tick = () => {
      tick()
      if (sim.ticks === 3) sim.held = true
    }
    expect(st.frame(500)).toBe(3)
    expect(st.ticks).toBe(3)
    expect(st.advance(2000)).toBe(0)
    st.destroy()
  })

  it('a real Sim: a debug card holds it (no tick runs, revision unchanged); a policy-played sim never holds', () => {
    const { game } = stubGame()
    const sim = makeSim(1)
    const st = installStepper(game, sim)
    expect(st.advance(1000)).toBe(10)
    expect(
      sim.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_wx_rain' }).ok,
    ).toBe(true)
    expect(sim.held).toBe(true)
    const rev = sim.revision
    const at = sim.state.tick
    for (let i = 0; i < 20; i++) st.frame(100)
    expect(st.advance(5000)).toBe(0)
    expect(sim.state.tick).toBe(at)
    expect(sim.revision).toBe(rev)
    st.destroy()

    const played = new Sim(dataFixture(), 2)
    const policy = createPolicy(played, 'competent')
    const st2 = installStepper(stubGame().game, played)
    st2.policy = policy
    expect(
      played.dispatch({ kind: 'debugOfferEvent', eventId: 'ev_wx_rain' }).ok,
    ).toBe(true)
    expect(played.held).toBe(false)
    expect(st2.advance(1000)).toBe(10)
    expect(played.state.events.open).toBeNull()
    policy.dispose?.()
    st2.destroy()
  })
})
