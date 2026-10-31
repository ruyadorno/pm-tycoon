// city-view.md §9.4 / spec §10: the game-over screen's headline and stats
// block (days survived, lifetime earned, parcels delivered, malware caught /
// missed, level reached, best day's $). Phaser is stubbed (the module
// imports the Button kit). Build 2 (report-playtest1 §6.12): Enter opens the
// run summary instead of starting a new game. Build 3 M12 (B3 §3.4): when an
// event option took the last life the headline names the card and the
// choice (`The recall — you chose: Take the strike`); the stats and buttons
// are unchanged.
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

const go = await import('../../src/ui/GameOverCard.ts')
const { claimKey, popModal, pushModal } = await import('../../src/ui/Sheet.ts')
const { dataFixture, makeSim } = await import('../sim/helpers.ts')
const { loseLifeEvent } = await import('../../src/sim/systems/economy.ts')

const data = dataFixture()

describe('§9.4: `Three malware parcels reached customers`', () => {
  it('counts the parcels in words', () => {
    expect(go.gameOverHeadline(3)).toBe(
      'Three malware parcels reached customers',
    )
    expect(go.gameOverHeadline(4)).toBe(
      'Four malware parcels reached customers',
    )
    expect(go.gameOverHeadline(1)).toBe('One malware parcel reached a customer')
    expect(go.gameOverHeadline(12)).toBe('12 malware parcels reached customers')
  })
})

describe("§9.4: best day's $ from the per-day rows", () => {
  it('is the largest daily step of the cumulative earned column', () => {
    const rows = [{ earned: 40 }, { earned: 140 }, { earned: 190 }]
    expect(go.bestDay(rows, 200)).toBe(100)
  })

  it('counts the running day (lifetime − the last row)', () => {
    expect(go.bestDay([{ earned: 40 }], 300)).toBe(260)
    expect(go.bestDay([], 75)).toBe(75)
  })
})

describe('§9.4: the stats block', () => {
  it('lists days, earned, clean deliveries, caught / missed, level, best day', () => {
    const m = go.gameOverModel(
      {
        day: 14,
        lifetimeEarned: 3410,
        deliveries: 215,
        malwareMissed: 3,
        defused: 9,
        level: 2,
        rows: [{ earned: 100 }, { earned: 450 }],
      },
      data,
    )
    expect(m.headline).toBe('Three malware parcels reached customers')
    const level = data.levels.find((l) => l.level === 2)!
    expect(m.stats).toEqual([
      ['Days survived', '14'],
      ['Lifetime earned', '$3,410'],
      ['Parcels delivered', '212'],
      ['Malware caught / missed', '9 / 3'],
      ['Level reached', `Lv2 ${level.title}`],
      ['Best day', '$2,960'],
    ])
  })

  it('never shows a negative delivery count', () => {
    const m = go.gameOverModel(
      {
        day: 0,
        lifetimeEarned: 0,
        deliveries: 1,
        malwareMissed: 3,
        defused: 0,
        level: 1,
        rows: [],
      },
      data,
    )
    expect(m.stats[2]).toEqual(['Parcels delivered', '0'])
  })
})

describe('B3 §3.4 (M12): the game-over event variant', () => {
  const input = {
    day: 9,
    lifetimeEarned: 2100,
    deliveries: 120,
    malwareMissed: 1,
    defused: 6,
    level: 2,
    rows: [{ earned: 300 }],
  }

  it('the headline is `{title} — you chose: {option}`; the stats are the same', () => {
    const plain = go.gameOverModel(input, data)
    const ev = go.gameOverModel(
      { ...input, event: { title: 'The recall', option: 'Take the strike' } },
      data,
    )
    expect(ev.headline).toBe('The recall — you chose: Take the strike')
    expect(ev.stats).toEqual(plain.stats)
  })

  it('without an event (absent or null) the malware headline is unchanged', () => {
    expect(go.gameOverModel(input, data).headline).toBe(
      'One malware parcel reached a customer',
    )
    expect(go.gameOverModel({ ...input, event: null }, data).headline).toBe(
      go.gameOverHeadline(1),
    )
  })

  it('from a real last-life strike: lastLostLife (kind event) feeds the variant (a reload shows it too)', () => {
    const sim = makeSim(1)
    sim.state.economy.lives = 1
    const over: string[] = []
    sim.events.on('game:over', (p) => over.push(p.cause))
    loseLifeEvent(sim, 'ev_sec_recall', 'The recall', 'Take the strike')
    expect(over).toEqual(['event'])
    const last = sim.state.lastLostLife
    expect(last?.kind).toBe('event')
    if (last?.kind !== 'event') throw new Error('no event report')
    const m = go.gameOverModel(
      { ...input, event: { title: last.title, option: last.option } },
      data,
    )
    expect(m.headline).toBe('The recall — you chose: Take the strike')
  })
})

const key = (k: string, repeat = false): KeyboardEvent =>
  ({ key: k, repeat }) as unknown as KeyboardEvent

function card(withSummary: boolean) {
  const onNewGame = vi.fn()
  const onSummary = vi.fn()
  const scene = { input: { keyboard: { on() {}, off() {} } } }
  const c = new go.GameOverCard(scene as never, {} as never, {
    onNewGame,
    onSummary: withSummary ? onSummary : null,
  })
  // open() builds the view; the key routing only needs the stack entry.
  pushModal(c)
  const onKey = (ev: KeyboardEvent): void =>
    (c as unknown as { onKey(ev: KeyboardEvent): void }).onKey(ev)
  return { c, onKey, onNewGame, onSummary }
}

describe('report §6.12: Enter on the game-over card', () => {
  it('opens the run summary, never a new game', () => {
    const { c, onKey, onNewGame, onSummary } = card(true)
    const ev = key('Enter')
    onKey(ev)
    expect(onSummary).toHaveBeenCalledOnce()
    expect(onNewGame).not.toHaveBeenCalled()
    expect(claimKey(ev, null)).toBe(false)
    popModal(c)
  })

  it('without a summary action Enter is swallowed (New game stays a tap)', () => {
    expect(go.gameOverEnterAction({ onSummary: null })).toBe('none')
    expect(go.gameOverEnterAction({ onSummary: () => {} })).toBe('summary')
    const { c, onKey, onNewGame } = card(false)
    const ev = key('Enter')
    onKey(ev)
    expect(onNewGame).not.toHaveBeenCalled()
    expect(claimKey(ev, null)).toBe(false)
    popModal(c)
  })

  it('a held Enter (repeat) and a card under another modal do nothing', () => {
    const { c, onKey, onSummary } = card(true)
    onKey(key('Enter', true))
    const dialog = {}
    pushModal(dialog)
    onKey(key('Enter'))
    expect(onSummary).not.toHaveBeenCalled()
    popModal(dialog)
    popModal(c)
  })
})
