// Autosave and the localStorage keys (plan.md §5 "localStorage keys", §6.4
// "Save and load"; spec §2 "autosave every 10 s and on hide"; city-view.md
// §9.5; spec-build2 §8): the payload shape {version: SAVE_VERSION (5 since
// M8), savedAt, build, dataHash, seed, state, onboarding} under pm.save.v2
// (pm.save.v2:cfg:<name> in a ?config= session, report-playtest1 §6.13), the
// Title header `Day 7 · $1,240 · Lv 2`, Continue only for the current
// version + same dataHash (an M5 version-2 payload included; else "Save
// from an older build was reset", a build-1 pm.save.v1 included), Reset
// clears every pm.save / pm.playtest key and the settings, settings {muted,
// speed} merge, and a failed write reports once and retries next cycle.
// M9: an endless-mode save (economy.victory) reads `… · Tycoon ✓` on the
// Continue line (its `Lv 5` dropped when too wide) and loads with
// LoadedGame.victory.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AUTOSAVE_MS,
  Autosave,
  checkSave,
  clearAllKeys,
  discardSave,
  LEGACY_SAVE_KEY,
  loadGame,
  newGame,
  parseSettings,
  PLAYTEST_KEY,
  playtestKey,
  readPlaytest,
  readSave,
  readSettings,
  SAVE_FAILED_TEXT,
  SAVE_KEY,
  saveConfig,
  saveHeader,
  saveKey,
  savedRun,
  setSaveConfig,
  SETTINGS_KEY,
  STALE_SAVE_TEXT,
  startupGame,
  STORAGE_KEYS,
  TYCOON_MARK,
  writeSettings,
  type KeyValueStore,
} from '../../src/boot/autosave.ts'
import { SAVE_VERSION, serialise } from '../../src/sim/save.ts'
import { Sim, stateHash } from '../../src/sim/sim.ts'
import { freshOnboarding } from '../../src/ui/Onboarding.ts'
import {
  acceptOffer,
  dataFixture,
  injectParcel,
  makeSim,
  noOffers,
  quiet,
  quietSim,
  runSeconds,
  runTicks,
} from '../sim/helpers.ts'

/** A Storage fake; enumerable (length / key) like localStorage. */
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
  get length(): number {
    return this.map.size
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null
  }
}

/** The minimal store (no enumeration), as robustness.test.ts uses. */
function plainStore(map: Map<string, string>): KeyValueStore {
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

const data = dataFixture()

function saverFor(
  store: KeyValueStore,
  sim = makeSim(1),
  onError?: (msg: string) => void,
  getPlaytest?: () => unknown,
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
    getPlaytest,
  })
  return { saver, sim, ob }
}

afterEach(() => setSaveConfig(undefined))

/**
 * A run whose Golden Release shipped (M9): L5 earned the levels.json way,
 * the offer accepted and its deliveries scripted (as tests/sim/endless.test.ts
 * does) — a valid endless-mode state.
 */
function wonSim(seed: number): Sim {
  const sim = noOffers(quietSim(seed))
  const L5 = data.levels.find((l) => l.level === 5)!
  sim.state.economy.lifetimeEarned = L5.threshold
  runTicks(sim, 1)
  quiet(sim)
  acceptOffer(sim)
  const u = L5.ultimateQuest!
  for (let i = 0; i < u.deliveries; i++) {
    const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    sim.emit('parcel:delivered', {
      id: p.id,
      paid: 20,
      onTime: true,
      malware: false,
    })
  }
  runTicks(sim, 1)
  if (!sim.state.economy.victory) throw new Error('no victory')
  return sim
}

describe('plan.md §5 / spec-build2 §8: the pm.* keys', () => {
  it('the build-2 keys; no ?config= under Node means the plain keys', () => {
    expect(SAVE_KEY).toBe('pm.save.v2')
    expect(LEGACY_SAVE_KEY).toBe('pm.save.v1')
    expect(SETTINGS_KEY).toBe('pm.settings.v1')
    // The profile stays v1 until M10; only the per-config suffix is new.
    expect(PLAYTEST_KEY).toBe('pm.playtest.v1')
    expect(saveConfig()).toBeNull()
    expect(saveKey()).toBe('pm.save.v2')
    expect(playtestKey()).toBe('pm.playtest.v1')
    expect(saveKey('spicy')).toBe('pm.save.v2:cfg:spicy')
    expect(playtestKey('spicy')).toBe('pm.playtest.v1:cfg:spicy')
    expect(STORAGE_KEYS).toEqual([
      'pm.save.v1',
      'pm.save.v2',
      'pm.settings.v1',
      'pm.playtest.v1',
    ])
  })

  it('Reset clears every pm.save key (v1, v2, every :cfg:), the settings and every playtest key', () => {
    const store = new MemoryStore()
    for (const k of [
      'pm.save.v1',
      'pm.save.v2',
      'pm.save.v2:cfg:spicy',
      'pm.save.v2:cfg:calm',
      'pm.settings.v1',
      'pm.playtest.v1',
      'pm.playtest.v1:cfg:spicy',
    ])
      store.setItem(k, '{}')
    store.setItem('other', 'kept')
    store.setItem('pm.other', 'kept')
    clearAllKeys(store)
    expect([...store.map.keys()].toSorted()).toEqual(['other', 'pm.other'])
    // From inside a config session too (the Title's Reset under ?config=).
    setSaveConfig('spicy')
    store.setItem('pm.save.v2', '{}')
    store.setItem('pm.save.v2:cfg:calm', '{}')
    clearAllKeys(store)
    expect([...store.map.keys()].toSorted()).toEqual(['other', 'pm.other'])
  })

  it('Reset without enumeration still clears the fixed keys and this session’s', () => {
    const map = new Map<string, string>()
    setSaveConfig('spicy')
    for (const k of [...STORAGE_KEYS, saveKey(), playtestKey()])
      map.set(k, '{}')
    clearAllKeys(plainStore(map))
    expect([...map.keys()]).toEqual([])
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
  it('writes the plan.md §5 payload shape under pm.save.v2', () => {
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
    // M6 bumped the state shape (design-m6 D18), M7 again (design-m7 §2.5),
    // M8 again (design-m8-m9 §2.4: lane.feedIndex, stats.cleared); the key
    // stays pm.save.v2.
    expect(SAVE_VERSION).toBe(5)
    expect(p.version).toBe(SAVE_VERSION)
    expect(p.state.version).toBe(SAVE_VERSION)
    expect(p.build).toBe('test-build')
    expect(p.dataHash).toBe(data.hash)
    expect(p.seed).toBe(sim.state.seed)
    expect(typeof p.savedAt).toBe('number')
    expect(p.onboarding).toEqual({ ...freshOnboarding(), step: 1 })
    // spec-build2 §2.8: the wanted list rides in the state, not the onboarding.
    expect(p.onboarding).not.toHaveProperty('wanted')
    expect(p.state.wanted).toEqual([])
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
    expect(checkSave(JSON.stringify({ ...p, version: 1 }), data).kind).toBe(
      'stale',
    )
    // An M5 (version 2) save is stale under M6 (design-m6 D18).
    expect(
      checkSave(
        JSON.stringify({ ...p, version: 2, state: { ...p.state, version: 2 } }),
        data,
      ).kind,
    ).toBe('stale')
    expect(checkSave(JSON.stringify(p), data).kind).toBe('ok')
    expect(STALE_SAVE_TEXT).toBe('Save from an older build was reset')
  })

  it('save v2 rejects a v1 save: pm.save.v1 reads stale, is removed with the toast, never loaded', () => {
    // A build-1 save as it sits on a player's device: version 1 throughout.
    const sim = makeSim(4)
    runSeconds(sim, 20)
    const v1 = JSON.parse(
      serialise(sim, { savedAt: 0, build: 'build-1', onboarding: null }),
    ) as { version: number; state: { version: number } }
    v1.version = 1
    v1.state.version = 1
    const v1Text = JSON.stringify(v1)
    expect(checkSave(v1Text, data).kind).toBe('stale')

    // The Title: readSave → stale → discardSave → STALE_SAVE_TEXT.
    const store = new MemoryStore()
    store.setItem(LEGACY_SAVE_KEY, v1Text)
    const check = readSave(data, store)
    expect(check.kind).toBe('stale')
    if (check.kind === 'stale') expect(check.problems[0]).toMatch(/pm.save.v1/)
    expect(savedRun(store)).toBeNull()
    discardSave(store)
    expect(store.getItem(LEGACY_SAVE_KEY)).toBeNull()
    expect(readSave(data, store).kind).toBe('none')

    // Even copied under the v2 key, a version-1 payload never loads.
    store.setItem(SAVE_KEY, v1Text)
    expect(readSave(data, store).kind).toBe('stale')

    // ?skipTitle=1: the same toast path, and the fresh sim is kept.
    const boot = new MemoryStore()
    boot.setItem(LEGACY_SAVE_KEY, v1Text)
    const got = startupGame(
      data,
      { skipTitle: true, newGame: false, seedFromUrl: false },
      boot,
    )
    expect(got).toEqual({ game: null, toast: STALE_SAVE_TEXT })
    expect(boot.map.size).toBe(0)
  })

  it('a v2 save wins over a leftover v1 save, and the first build-2 save removes pm.save.v1', () => {
    const store = new MemoryStore()
    store.setItem(LEGACY_SAVE_KEY, '{"version":1}')
    const { saver } = saverFor(store, makeSim(6))
    expect(saver.save('manual')).toBe(true)
    expect(store.getItem(LEGACY_SAVE_KEY)).toBeNull()
    store.setItem(LEGACY_SAVE_KEY, '{"version":1}')
    expect(readSave(data, store).kind).toBe('ok')
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

  it("M6: the run's wanted list comes back with the state; a stored onboarding `wanted` is dropped", () => {
    const store = new MemoryStore()
    const sim = makeSim(5)
    sim.state.wanted.push('evil-lodash')
    const { saver, ob } = saverFor(store, sim)
    // An M5-era registry object still carrying the UI-side list.
    Object.assign(ob, { wanted: ['stale-label'] })
    expect(saver.save('manual')).toBe(true)
    const check = readSave(data, store)
    expect(check.kind).toBe('ok')
    if (check.kind !== 'ok') return
    const game = loadGame(data, check.payload)
    expect(game.sim.state.wanted).toEqual(['evil-lodash'])
    expect(game.onboarding).not.toHaveProperty('wanted')
  })

  it('New game starts the §7.1 state with a fresh tour', () => {
    const game = newGame(data, 42)
    expect(game.sim.state.tick).toBe(0)
    expect(game.sim.state.economy.balance).toBe(data.economy.startMoney)
    expect(game.onboarding).toEqual(freshOnboarding())
    expect(game.victory).toBe(false)
  })

  it('M9 (B2 §3.4, design-m8-m9 §6.3): an endless-mode save reads "… · Lv 5 · Tycoon ✓" and loads with LoadedGame.victory', () => {
    const store = new MemoryStore()
    const sim = wonSim(8)
    const { saver } = saverFor(store, sim)
    expect(saver.save('manual')).toBe(true)
    const check = readSave(data, store)
    expect(check).toMatchObject({ kind: 'ok' })
    if (check.kind !== 'ok') return
    expect(TYCOON_MARK).toBe('Tycoon ✓')
    const s = sim.state
    expect(check.header).toBe(
      `Day ${s.day + 1} · $${s.economy.balance.toLocaleString('en-US')} · Lv 5 · Tycoon ✓`,
    )
    const game = loadGame(data, check.payload)
    expect(game.victory).toBe(true)
    expect(game.sim.state.economy.victory).toBe(true)
    // A run that has not won keeps the plain header and victory false.
    const plain = readSave(
      data,
      (() => {
        const st = new MemoryStore()
        saverFor(st, makeSim(8)).saver.save('manual')
        return st
      })(),
    )
    if (plain.kind !== 'ok') throw new Error('plain save')
    expect(plain.header).not.toMatch(/Tycoon/)
    expect(loadGame(data, plain.payload).victory).toBe(false)
  })

  it('M9: the Continue line fits the 200-px Title button in m5x7 — a winning header too wide drops its "Lv 5"', () => {
    const xml = readFileSync(
      new URL('../../src/assets/m5x7.xml', import.meta.url),
      'utf8',
    )
    const adv = new Map<number, number>()
    for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
      adv.set(Number(m[1]), Number(m[2]))
    // ✓ is drawn by tools/art/font.ts (M9); a missing glyph counts 8 px.
    const measure = (t: string): number =>
      [...t].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 8), 0)
    // layout.buttonColumn's 200-px button less Button CONTENT_PAD (5) a side.
    const fit = { maxW: 200 - 2 * 5, measure }
    const sim = makeSim(9)
    const p = JSON.parse(
      serialise(sim, { savedAt: 0, build: 'b', onboarding: null }),
    ) as Parameters<typeof saveHeader>[0]
    p.state.level.level = 5
    p.state.economy.victory = true
    p.state.day = 11
    p.state.economy.balance = 18400
    const typical = saveHeader(p, fit)
    expect(typical).toBe('Day 12 · $18,400 · Lv 5 · Tycoon ✓')
    expect(measure(typical)).toBeLessThanOrEqual(fit.maxW)
    // A long endless run: the level goes, the mark stays.
    p.state.day = 119
    p.state.economy.balance = 1_234_567
    const long = saveHeader(p, fit)
    expect(long).toBe('Day 120 · $1,234,567 · Tycoon ✓')
    expect(measure(long)).toBeLessThanOrEqual(fit.maxW)
    // Without `fit` (the Overwrite dialog, which wraps) the full header.
    expect(saveHeader(p)).toBe('Day 120 · $1,234,567 · Lv 5 · Tycoon ✓')
    // A run that has not won is never shortened.
    p.state.economy.victory = false
    expect(saveHeader(p, fit)).toBe('Day 120 · $1,234,567 · Lv 5')
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

describe('report-playtest1 §6.13: a ?config session keeps its own save', () => {
  it('a ?config session uses its own key: pm.save.v2:cfg:<name>, and never touches the cold save', () => {
    const store = new MemoryStore()
    // The cold run, saved first.
    const cold = makeSim(3)
    runSeconds(cold, 10)
    const coldSaver = saverFor(store, cold, undefined, () => ({ run: 'cold' }))
    expect(coldSaver.saver.save('manual')).toBe(true)
    const coldText = store.getItem('pm.save.v2')
    expect(coldText).not.toBeNull()

    // A spicy session (other data tables, so another dataHash): its own key.
    setSaveConfig('spicy')
    expect(saveConfig()).toBe('spicy')
    expect(saveKey()).toBe('pm.save.v2:cfg:spicy')
    expect(playtestKey()).toBe('pm.playtest.v1:cfg:spicy')
    const spicyData = dataFixture({ economy: { startMoney: 600 } })
    expect(spicyData.hash).not.toBe(data.hash)
    // Nothing saved for spicy yet: none (not stale), so no toast and no
    // discard of the cold save.
    expect(readSave(spicyData, store).kind).toBe('none')
    expect(readPlaytest(store)).toBeNull()
    expect(
      startupGame(
        spicyData,
        { skipTitle: true, newGame: false, seedFromUrl: false },
        store,
      ),
    ).toEqual({ game: null, toast: null })
    const spicy = new Sim(spicyData, 11)
    const spicySaver = saverFor(store, spicy, undefined, () => ({
      run: 'spicy',
    }))
    expect(spicySaver.saver.save('manual')).toBe(true)
    expect(store.getItem('pm.save.v2')).toBe(coldText)
    expect(JSON.parse(store.getItem('pm.playtest.v1')!)).toEqual({
      run: 'cold',
    })
    expect(JSON.parse(store.getItem('pm.playtest.v1:cfg:spicy')!)).toEqual({
      run: 'spicy',
    })
    const s = readSave(spicyData, store)
    expect(s.kind).toBe('ok')
    if (s.kind === 'ok') expect(s.payload.seed).toBe(11)
    expect(savedRun(store)?.seed).toBe(11)
    expect(readPlaytest(store)).toEqual({ run: 'spicy' })
    // New game in the spicy session drops the spicy save only.
    discardSave(store)
    expect(store.getItem('pm.save.v2:cfg:spicy')).toBeNull()
    expect(store.getItem('pm.save.v2')).toBe(coldText)

    // Back without ?config: the cold save is still there and loads.
    setSaveConfig(null)
    expect(saveKey()).toBe('pm.save.v2')
    const back = readSave(data, store)
    expect(back.kind).toBe('ok')
    if (back.kind !== 'ok') return
    expect(stateHash(loadGame(data, back.payload).sim.state)).toBe(
      stateHash(cold.state),
    )
    expect(readPlaytest(store)).toEqual({ run: 'cold' })
  })
})
