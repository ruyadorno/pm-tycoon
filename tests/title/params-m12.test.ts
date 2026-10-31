// Build 3 M12 URL params (B3 §3.4, §6; plan-build3 §8.3): ?event=<id> asks
// Boot to offer that events.json deck card (debug.offerEvent) on a fresh
// game; null when absent or blank, passed through as written (trimmed: the
// sim refuses an unknown id and Boot warns). offerEventParam's fresh rule:
// tick 0 with nothing in the command log but ?level='s debugForceLevel and
// ?quest='s debugOfferQuest — so it never touches a Continue, a __pm.load
// or a config start, and runs once per game (its own debugOfferEvent makes
// the game not fresh). The card it opens holds a policy-less sim from tick
// 0 (B3 §6): stepping does nothing until it is answered. Phaser is stubbed
// (BootScene imports the scene kit).
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
      Renderer: { WebGL: { WebGLRenderer: Stub } },
      Core: { Events: {} },
      Scenes: { Events: {} },
    },
  }
})

const { parseParams } = await import('../../src/debug/params.ts')
const { offerEventParam, offerQuestParam, forceLevelParam, newGameSwap } =
  await import('../../src/scenes/BootScene.ts')
const { SIM_REPLACED, setSim } = await import('../../src/boot/simBinding.ts')
const { loadGame, newGame } = await import('../../src/boot/autosave.ts')
const { deserialise, serialise } = await import('../../src/sim/save.ts')
const { freshOnboarding } = await import('../../src/ui/Onboarding.ts')
const { Sim } = await import('../../src/sim/sim.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { dataFixture } = await import('../sim/helpers.ts')

const data = dataFixture()

/** A fresh browser game (deck as shipped) with the debug facet. */
function fresh(seed = 7) {
  const sim = new Sim(data, seed)
  return { sim, vs: createViewSim(sim, { debug: true }) }
}

describe('parseParams: event', () => {
  it('is null when absent or blank', () => {
    for (const q of ['', '?event=', '?event=%20%20', '?seed=7&debug=1'])
      expect(parseParams(q, 1).event, q).toBeNull()
  })

  it('reads ?event=<eventId> (trimmed, case kept)', () => {
    expect(parseParams('?event=ev_money_grant', 1).event).toBe('ev_money_grant')
    expect(
      parseParams('?seed=7&debug=1&event=ev_wx_rain&quest=rush_district', 1)
        .event,
    ).toBe('ev_wx_rain')
    expect(parseParams('?event=%20ev_sec_recall%20', 1).event).toBe(
      'ev_sec_recall',
    )
    expect(parseParams('?event=Nope', 1).event).toBe('Nope')
  })

  it('leaves the other params alone', () => {
    const a = parseParams('?seed=7&level=2&quest=rush_district', 1)
    const b = parseParams(
      '?seed=7&level=2&quest=rush_district&event=ev_wx_rain',
      1,
    )
    expect({ ...b, event: null }).toEqual(a)
  })
})

describe('offerEventParam: a fresh game only', () => {
  it('nothing asked, or no debug facet: null and nothing dispatched', () => {
    const { sim, vs } = fresh()
    expect(offerEventParam(vs, sim, null)).toBeNull()
    const plain = createViewSim(sim)
    expect(offerEventParam(plain, sim, 'ev_money_grant')).toBeNull()
    expect(sim.commandLog).toHaveLength(0)
    expect(sim.state.events.open).toBeNull()
  })

  it('tick 0: the card opens (a logged debugOfferEvent) and holds the sim — stepping does nothing until it is answered', () => {
    const { sim, vs } = fresh()
    const res = offerEventParam(vs, sim, 'ev_money_grant')
    expect(res).toEqual({ ok: true })
    expect(sim.commandLog.map((e) => e.cmd.kind)).toEqual(['debugOfferEvent'])
    expect(vs.events().open?.eventId).toBe('ev_money_grant')
    expect(sim.held).toBe(true)
    expect(vs.held).toBe(true)
    for (let i = 0; i < 50; i++) sim.tick()
    expect(sim.state.tick).toBe(0)
    // Once per game: its own command makes the game not fresh.
    expect(offerEventParam(vs, sim, 'ev_wx_rain')).toBeNull()
    expect(sim.commandLog).toHaveLength(1)
  })

  it('refused after any other command (a config start, a player command) and past tick 0 (a Continue, a __pm.load)', () => {
    const a = fresh()
    const slot = a.sim.state.lane.nodes.find(
      (n) => n.kind === 'slot' && n.fixture === null,
    )!
    expect(
      a.sim.dispatch({
        kind: 'buyMachine',
        defId: 'metal_detector',
        nodeId: slot.id,
      }).ok,
    ).toBe(true)
    expect(offerEventParam(a.vs, a.sim, 'ev_money_grant')).toBeNull()
    expect(a.sim.state.events.open).toBeNull()
    const b = fresh(8)
    b.sim.state.tick = 1
    expect(offerEventParam(b.vs, b.sim, 'ev_money_grant')).toBeNull()
    expect(b.sim.commandLog).toHaveLength(0)
    expect(b.sim.state.events.open).toBeNull()
  })

  it("allowed after ?level='s debugForceLevel and ?quest='s debugOfferQuest (a job card opened first: the event queues behind it)", () => {
    const { sim, vs } = fresh(9)
    forceLevelParam(vs, sim, 2)
    expect(offerQuestParam(vs, sim, 'rush_district')?.ok).toBe(true)
    expect(vs.events().open?.kind).toBe('job')
    const res = offerEventParam(vs, sim, 'ev_money_grant')
    expect(res?.ok).toBe(true)
    expect(sim.commandLog.map((e) => e.cmd.kind)).toEqual([
      'debugForceLevel',
      'debugOfferQuest',
      'debugOfferEvent',
    ])
    expect(vs.events().open?.kind).toBe('job')
    expect(vs.events().queue).toBe(1)
    expect(sim.state.events.queue.map((q) => q.eventId)).toEqual([
      'ev_money_grant',
    ])
  })

  it('an unknown id is refused by the sim (warned, never thrown)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sim, vs } = fresh()
    const res = offerEventParam(vs, sim, 'ev_nope')
    expect(res?.ok).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('event=ev_nope'))
    expect(sim.state.events.open).toBeNull()
    warn.mockRestore()
  })
})

describe('review sim-4: the debug offers follow a New game swap only (SimReplaced.fresh)', () => {
  it('newGameSwap: a fresh, non-attract swap', () => {
    expect(newGameSwap({ attract: false, fresh: true })).toBe(true)
    expect(newGameSwap({ attract: false, fresh: false })).toBe(false)
    expect(newGameSwap({ attract: true, fresh: true })).toBe(false)
    expect(newGameSwap({ attract: true, fresh: false })).toBe(false)
  })

  it('setSim carries the fresh flag (the Title passes LoadedGame.fresh); a plain swap (__pm.load) and the attract sim are never fresh', () => {
    const reg = new Map<string, unknown>()
    const seen: { fresh: boolean; attract: boolean }[] = []
    const game = {
      registry: {
        get: (k: string) => reg.get(k),
        set: (k: string, v: unknown) => reg.set(k, v),
      },
      events: {
        emit: (n: string, p: { fresh: boolean; attract: boolean }) => {
          if (n === SIM_REPLACED)
            seen.push({ fresh: p.fresh, attract: p.attract })
        },
      },
    } as never
    setSim(game, new Sim(data, 1))
    setSim(game, new Sim(data, 2), { attract: true, fresh: true })
    setSim(game, newGame(data, 3).sim, { fresh: newGame(data, 3).fresh })
    setSim(game, new Sim(data, 4))
    expect(seen).toEqual([
      { fresh: false, attract: true },
      { fresh: true, attract: false },
      { fresh: false, attract: false },
    ])
  })

  it('a ?quest= game held at tick 0 and saved still passes the tick-0 test on Continue — LoadedGame.fresh (false) is what keeps ?event= out', () => {
    const { sim, vs } = fresh(3)
    expect(offerQuestParam(vs, sim, 'rush_district')?.ok).toBe(true)
    for (let i = 0; i < 50; i++) sim.tick()
    expect(sim.state.tick).toBe(0)
    const payload = deserialise(
      serialise(sim, {
        savedAt: 1,
        build: 'test',
        onboarding: freshOnboarding(),
      }),
    )
    const game = loadGame(data, payload)
    expect(game.fresh).toBe(false)
    expect(game.sim.state.tick).toBe(0)
    expect(game.sim.commandLog.map((e) => e.cmd.kind)).toEqual([
      'debugOfferQuest',
    ])
    // The Title's Continue swap: Boot's listeners skip it.
    expect(newGameSwap({ attract: false, fresh: game.fresh })).toBe(false)
    // (The tick-0 test alone would have taken it: the bug.)
    const gvs = createViewSim(game.sim, { debug: true })
    expect(offerEventParam(gvs, game.sim, 'ev_sec_recall')?.ok).toBe(true)
  })
})
