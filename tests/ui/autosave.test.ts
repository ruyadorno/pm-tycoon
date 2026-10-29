// Autosave and the localStorage keys (plan.md §5 "localStorage keys", §6.4
// "Save and load"; spec §2 "autosave every 10 s and on hide"; city-view.md
// §9.5): the payload shape {version: 1, savedAt, build, dataHash, seed,
// state, onboarding} under pm.save.v1, the Title header `Day 7 · $1,240 ·
// Lv 2`, Continue only for version 1 + same dataHash (else "Save from an
// older build was reset"), Reset clears the three keys, settings {muted,
// speed} merge, and a failed write reports once and retries next cycle.
import { describe, expect, it } from 'vitest'
import {
  AUTOSAVE_MS,
  Autosave,
  checkSave,
  clearAllKeys,
  loadGame,
  newGame,
  parseSettings,
  readSave,
  readSettings,
  SAVE_FAILED_TEXT,
  SAVE_KEY,
  saveHeader,
  SETTINGS_KEY,
  STALE_SAVE_TEXT,
  startupGame,
  STORAGE_KEYS,
  writeSettings,
  type KeyValueStore,
} from '../../src/boot/autosave.ts'
import { serialise } from '../../src/sim/save.ts'
import { stateHash } from '../../src/sim/sim.ts'
import { freshOnboarding } from '../../src/ui/Onboarding.ts'
import { dataFixture, makeSim, runSeconds } from '../sim/helpers.ts'

class MemoryStore implements KeyValueStore {
  readonly map = new Map<string, string>()
  failWrites = false
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError')
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
}

const data = dataFixture()

function saverFor(
  store: MemoryStore,
  sim = makeSim(1),
  onError?: (msg: string) => void,
) {
  const ob = freshOnboarding()
  let now = 1_700_000_000_000
  const saver = new Autosave({
    getSim: () => sim,
    getOnboarding: () => ob,
    build: 'test-build',
    now: () => now++,
    store,
    onError,
  })
  return { saver, sim, ob }
}

describe('plan.md §5: the three pm.* keys', () => {
  it('Reset clears pm.save.v1, pm.settings.v1 and pm.playtest.v1', () => {
    expect(STORAGE_KEYS).toEqual([
      'pm.save.v1',
      'pm.settings.v1',
      'pm.playtest.v1',
    ])
    const store = new MemoryStore()
    for (const k of STORAGE_KEYS) store.setItem(k, '{}')
    store.setItem('other', 'kept')
    clearAllKeys(store)
    expect([...store.map.keys()]).toEqual(['other'])
  })

  it('pm.settings.v1 {muted, speed}: defaults, parse and merge', () => {
    expect(parseSettings(null)).toEqual({ muted: false, speed: 1 })
    expect(parseSettings('not json')).toEqual({ muted: false, speed: 1 })
    expect(parseSettings('{"muted":true,"speed":2}')).toEqual({
      muted: true,
      speed: 2,
    })
    // Pause / 4x are never restored as the running speed.
    expect(parseSettings('{"speed":0}').speed).toBe(1)
    expect(parseSettings('{"speed":4}').speed).toBe(1)
    const store = new MemoryStore()
    // The AudioDirector writes `muted` through its own store; ours keeps it.
    store.setItem(SETTINGS_KEY, '{"muted":true,"extra":1}')
    expect(writeSettings({ speed: 2 }, store)).toBe(true)
    expect(JSON.parse(store.getItem(SETTINGS_KEY)!)).toEqual({
      muted: true,
      extra: 1,
      speed: 2,
    })
    expect(readSettings(store)).toEqual({ muted: true, speed: 2 })
  })
})

describe('spec §2: autosave every 10 s of real time and on hide', () => {
  it('writes the plan.md §5 payload shape under pm.save.v1', () => {
    const store = new MemoryStore()
    const { saver, sim, ob } = saverFor(store)
    ob.step = 1
    expect(saver.save('hidden')).toBe(true)
    const p = JSON.parse(store.getItem(SAVE_KEY)!)
    expect(Object.keys(p).toSorted()).toEqual(
      [
        'build',
        'commandLog',
        'dataHash',
        'onboarding',
        'savedAt',
        'seed',
        'state',
        'version',
      ].toSorted(),
    )
    expect(p.version).toBe(1)
    expect(p.build).toBe('test-build')
    expect(p.dataHash).toBe(data.hash)
    expect(p.seed).toBe(sim.state.seed)
    expect(typeof p.savedAt).toBe('number')
    expect(p.onboarding).toEqual({ ...freshOnboarding(), step: 1 })
  })

  it('the timer saves once 10 s have accumulated, then restarts', () => {
    const store = new MemoryStore()
    const { saver } = saverFor(store)
    expect(AUTOSAVE_MS).toBe(10_000)
    expect(saver.tick(9_999)).toBe(false)
    expect(store.getItem(SAVE_KEY)).toBeNull()
    expect(saver.tick(1)).toBe(true)
    expect(store.getItem(SAVE_KEY)).not.toBeNull()
    expect(saver.elapsed).toBe(0)
    expect(saver.tick(5_000)).toBe(false)
  })

  it('a failed write toasts once per failure streak and retries next cycle', () => {
    const store = new MemoryStore()
    const errors: string[] = []
    const { saver } = saverFor(store, makeSim(1), (m) => errors.push(m))
    store.failWrites = true
    const warn = console.warn
    console.warn = () => {}
    try {
      expect(saver.save('timer')).toBe(false)
      expect(saver.tick(AUTOSAVE_MS)).toBe(false)
    } finally {
      console.warn = warn
    }
    expect(errors).toEqual([SAVE_FAILED_TEXT])
    expect(saver.failures).toBe(2)
    store.failWrites = false
    expect(saver.tick(AUTOSAVE_MS)).toBe(true)
    expect(saver.failures).toBe(0)
  })

  it('a disabled autosave writes nothing', () => {
    const store = new MemoryStore()
    const { saver } = saverFor(store)
    saver.enabled = false
    expect(saver.save('pagehide')).toBe(false)
    expect(saver.tick(AUTOSAVE_MS * 2)).toBe(false)
    expect(store.getItem(SAVE_KEY)).toBeNull()
  })
})

describe('city-view §9.5 / plan.md §6.4: Title Continue', () => {
  it('the save header reads "Day N · $money · Lv L" (Day = completed days + 1)', () => {
    const sim = makeSim(3)
    const text = serialise(sim, { savedAt: 0, build: 'b', onboarding: null })
    const check = checkSave(text, data)
    expect(check.kind).toBe('ok')
    if (check.kind !== 'ok') return
    expect(check.header).toBe(`Day 1 · $${data.economy.startMoney} · Lv 1`)
    const p = check.payload
    p.state.day = 6
    p.state.economy.balance = 1240
    p.state.level.level = 2
    expect(saveHeader(p)).toBe('Day 7 · $1,240 · Lv 2')
  })

  it('no save → none; garbage or another dataHash/version → stale', () => {
    expect(checkSave(null, data).kind).toBe('none')
    expect(checkSave('{oops', data).kind).toBe('stale')
    const sim = makeSim(1)
    const p = JSON.parse(
      serialise(sim, { savedAt: 0, build: 'b', onboarding: null }),
    )
    expect(
      checkSave(JSON.stringify({ ...p, dataHash: 'older' }), data).kind,
    ).toBe('stale')
    expect(checkSave(JSON.stringify({ ...p, version: 0 }), data).kind).toBe(
      'stale',
    )
    expect(STALE_SAVE_TEXT).toBe('Save from an older build was reset')
  })

  it('Continue resumes the saved game tick-exact with its tour state', () => {
    const store = new MemoryStore()
    const sim = makeSim(5)
    runSeconds(sim, 30)
    const { saver, ob } = saverFor(store, sim)
    ob.step = 1
    expect(saver.save('manual')).toBe(true)
    const check = readSave(data, store)
    expect(check.kind).toBe('ok')
    if (check.kind !== 'ok') return
    const game = loadGame(data, check.payload)
    expect(game.sim.state.tick).toBe(sim.state.tick)
    expect(stateHash(game.sim.state)).toBe(stateHash(sim.state))
    expect(game.onboarding.step).toBe(1)
  })

  it('New game starts the §7.1 state with a fresh tour', () => {
    const game = newGame(data, 42)
    expect(game.sim.state.tick).toBe(0)
    expect(game.sim.state.economy.balance).toBe(data.economy.startMoney)
    expect(game.onboarding).toEqual(freshOnboarding())
  })
})

describe('plan.md §5 URL params: ?skipTitle=1 resumes unless ?newGame=1 / ?seed=', () => {
  const opts = { skipTitle: true, newGame: false, seedFromUrl: false }

  it('resumes a compatible autosave when the Title is skipped', () => {
    const store = new MemoryStore()
    const { saver } = saverFor(store, makeSim(9))
    saver.save('manual')
    const got = startupGame(data, opts, store)
    expect(got.toast).toBeNull()
    expect(got.game?.sim.state.seed).toBe(9)
  })

  it('keeps the fresh sim with ?newGame=1, an explicit ?seed= or the Title', () => {
    const store = new MemoryStore()
    saverFor(store, makeSim(9)).saver.save('manual')
    expect(startupGame(data, { ...opts, newGame: true }, store).game).toBeNull()
    expect(
      startupGame(data, { ...opts, seedFromUrl: true }, store).game,
    ).toBeNull()
    expect(
      startupGame(data, { ...opts, skipTitle: false }, store).game,
    ).toBeNull()
    expect(store.getItem(SAVE_KEY)).not.toBeNull()
  })

  it('discards a stale save with the "older build" toast', () => {
    const store = new MemoryStore()
    store.setItem(SAVE_KEY, '{"version":0}')
    const got = startupGame(data, opts, store)
    expect(got.game).toBeNull()
    expect(got.toast).toBe(STALE_SAVE_TEXT)
    expect(store.getItem(SAVE_KEY)).toBeNull()
  })
})
