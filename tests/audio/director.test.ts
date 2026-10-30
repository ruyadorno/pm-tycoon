// audio.md §3, §6, §7: the AudioDirector's contract under Node — it never throws into the game, nothing sounds
// before the unlock gesture, the unlock resumes the context and Tone inside the gesture, a tab hide silences
// the stingers too, the loops keep their "1 per N s" throttles, and stingers land on the band's swung grid.
// Tone is replaced by a fake Transport (src/audio/tone.ts is the only Tone entry point); Web Audio by a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Band } from '../../src/audio/band.ts'
import {
  type AudioDirector,
  createAudioDirector,
  type Emitter,
  localSettingsStore,
  readAudioParams,
} from '../../src/audio/director.ts'
import { type AudioData, defaultAudioData } from '../../src/audio/data.ts'
import { InstrumentBank } from '../../src/audio/instruments.ts'
import { NoteLog } from '../../src/audio/log.ts'
import { asContext, FakeAudioContext } from './fake-audio.ts'

const tone = vi.hoisted(() => {
  const T = {
    state: 'stopped' as 'started' | 'stopped' | 'paused',
    PPQ: 192,
    bpm: { value: 120 },
    swing: 0,
    timeSignature: 4,
    loop: false,
    loopStart: 0 as number | string,
    loopEnd: '0' as number | string,
    position: 0 as number | string,
    ticks: 0,
    scheduleRepeat: () => 1,
    clear: () => undefined,
    start: () => undefined,
    stop: () => undefined,
    pause: () => undefined,
    /** the Transport started at context time 0 */
    getTicksAtTime: (t: number) => t * (T.bpm.value / 60) * T.PPQ,
  }
  return { T, starts: { count: 0 } }
})

vi.mock('../../src/audio/tone.ts', () => ({
  bindToneClock: () => undefined,
  isToneBound: () => true,
  getTransport: () => tone.T,
  toneNow: () => 0,
  toneStart: () => {
    tone.starts.count++
    return Promise.resolve()
  },
}))

class Bus implements Emitter {
  #m = new Map<string, Set<(...a: unknown[]) => void>>()
  on(n: string, f: (...a: unknown[]) => void) {
    if (!this.#m.has(n)) this.#m.set(n, new Set())
    this.#m.get(n)?.add(f)
    return this
  }
  off(n: string, f: (...a: unknown[]) => void) {
    this.#m.get(n)?.delete(f)
    return this
  }
  emit(n: string, ...a: unknown[]) {
    for (const f of this.#m.get(n) ?? []) f(...a)
    return true
  }
}

const base = defaultAudioData()
/** music off: these tests drive the SFX, loops and stingers, not the band */
const data: AudioData = { ...base, config: { ...base.config, music: 'off' } }

function make(ctx = new FakeAudioContext(), extra = {}) {
  const game = new Bus()
  const sim = new Bus()
  const d = createAudioDirector({
    ctx: asContext(ctx),
    settings: null,
    events: game,
    data,
    ...extra,
  })
  return { ctx, d, game, sim }
}

const throwing = () => {
  throw new Error('boom')
}

async function unlocked() {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'performance',
    ],
  })
  const t = make()
  await t.d.unlock()
  t.d.attachSim(t.sim)
  return t
}

function storage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial))
  const writes: string[] = []
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(k)
      m.set(k, v)
    },
  })
  return { m, writes }
}

const played = (d: AudioDirector, name: string) =>
  d.log.sfxEntries().filter((e) => e.sfx === name && !e.dropped).length

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline test')))
  tone.T.state = 'stopped'
  tone.starts.count = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AudioDirector: never throws into the game', () => {
  it('falls back to a disabled director when Web Audio fails while building the graph', () => {
    const ctx = new FakeAudioContext()
    ctx.failGraph = true
    const { d } = make(ctx)
    expect(d.disabled).toBe(true)
    expect(d.state().errors.join()).toMatch(/audio setup failed/)
    expect(() => d.unlock()).not.toThrow()
    expect(d.playNamed('tap')).toBe(false)
  })

  it('survives a throwing settings store, registry or emitter (logged, never thrown)', () => {
    const d = createAudioDirector({
      ctx: asContext(new FakeAudioContext()),
      settings: { readMuted: throwing, writeMuted: throwing },
      registry: { set: throwing },
      events: { on: throwing, off: throwing, emit: throwing },
      data,
    })
    expect(d.disabled).toBe(false)
    expect(d.isMuted()).toBe(false)
    expect(() => d.setMuted(true)).not.toThrow()
    const errors = d.state().errors.join()
    for (const step of ['settings', 'registry', 'attachGame'])
      expect(errors).toContain(`${step}: boom`)
  })

  it('the factory falls back to a disabled director when construction throws anyway', () => {
    const d = createAudioDirector({
      ctx: asContext(new FakeAudioContext()),
      settings: null,
      data,
      params: {
        get disabled(): boolean {
          throw new Error('params getter')
        },
      },
    })
    expect(d.disabled).toBe(true)
    expect(
      d.log.entries().some((e) => 'info' in e && /fell back/.test(e.info)),
    ).toBe(true)
  })

  it('keeps a throwing lookup or handler out of the sim emitter (and so out of Sim.tick)', async () => {
    const { d, sim } = make()
    await d.unlock()
    d.attachSim(sim, {
      parcelSize: () => {
        throw new Error('lookup bug')
      },
    })
    expect(() =>
      sim.emit('parcel:delivered', { id: 'p1', paid: 5, onTime: true }),
    ).not.toThrow()
    expect(d.state().errors.join()).toMatch(/sim parcel:delivered: lookup bug/)
    // the director keeps working afterwards
    sim.emit('parcel:pickedUp', { id: 'p2' })
    expect(played(d, 'pickup')).toBe(1)
  })

  it('survives every sample failing to load: errors in state(), no music, no throw', async () => {
    // fetch rejects for every preset (beforeEach): an offline phone, a bad deploy path
    const live: AudioData = {
      ...base,
      config: { ...base.config, music: 'live' },
    }
    const { d } = make(new FakeAudioContext(), { data: live })
    await expect(d.unlock()).resolves.toBeUndefined()
    await d.preload()
    const st = d.state()
    expect(Object.values(st.loaded).every((v) => v === false)).toBe(true)
    expect(
      st.errors.some((e) => /instrument piano: .*offline test/.test(e)),
    ).toBe(true)
    expect(st.transport.state).toBe('stopped')
    expect(() => d.startMusic()).not.toThrow()
    expect(() => d.hook('level:up', { level: 2 })).not.toThrow() // stinger: logged, not played
    expect(d.playNamed('tap')).toBe(true) // zzfx SFX need no samples
  })

  it('a disabled director starts no loop timers', () => {
    vi.useFakeTimers()
    const sim = new Bus()
    const d = createAudioDirector({ ctx: null, settings: null, data })
    d.attachSim(sim)
    sim.emit('lane:stalled', { reason: 'shelfFull' })
    sim.emit('parcel:held', { id: 'p' })
    d.setGrumble(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('AudioDirector: mute (audio.md §3.5, pm.settings.v1)', () => {
  it('reads the persisted flag, persists toggles and keeps the other settings (speed)', () => {
    const s = storage({ 'pm.settings.v1': '{"muted":true,"speed":2}' })
    const { d, game } = make(new FakeAudioContext(), {
      settings: localSettingsStore(),
    })
    const muted: unknown[] = []
    game.on('audio:muted', (p) => muted.push(p))
    expect(d.isMuted()).toBe(true)
    expect(d.toggleMuted()).toBe(false)
    expect(JSON.parse(s.m.get('pm.settings.v1') ?? '')).toEqual({
      muted: false,
      speed: 2,
    })
    expect(muted).toEqual([{ muted: false }])
  })

  it('?mute=1 starts muted without writing localStorage; a broken value reads as unmuted', () => {
    const s = storage({ 'pm.settings.v1': '{not json' })
    expect(readAudioParams('?mute=1&audiolog=1')).toEqual({
      disabled: false,
      muted: true,
      log: true,
    })
    expect(localSettingsStore().readMuted()).toBe(null)
    const { d } = make(new FakeAudioContext(), {
      settings: localSettingsStore(),
      params: readAudioParams('?mute=1'),
    })
    expect(d.isMuted()).toBe(true)
    expect(s.writes).toEqual([])
    expect(readAudioParams('?audio=0').disabled).toBe(true)
  })
})

describe('AudioDirector: boot cost (audio.md §3.1: zzfx renders < 5 ms at boot)', () => {
  it('renders no zzfx buffer in the constructor: one per macrotask afterwards, or on demand', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { d } = make()
    expect(d.sfx.names()).toEqual([])
    vi.advanceTimersByTime(0)
    expect(d.sfx.names()).toHaveLength(1)
    // a sound played before its turn renders on demand (still gated on the unlock)
    void d.unlock()
    expect(d.playNamed('levelUp')).toBe(false) // context still resuming
    vi.runAllTimers()
    expect(d.sfx.pending()).toEqual([])
    // every one-shot of sfx.json (build 2 M7 adds questDone); ride and hat belong to the band
    expect(d.sfx.names()).toHaveLength(
      Object.keys(base.sfx).filter((n) => n !== 'ride' && n !== 'hat').length,
    )
    expect(d.sfx.names()).toContain('questDone')
    expect(d.state().sfxRenderMs).toBeGreaterThanOrEqual(0)
    expect(d.state().errors).toEqual([])
  })

  it('a disabled director renders nothing and schedules nothing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { d } = make(new FakeAudioContext(), { params: { disabled: true } })
    expect(vi.getTimerCount()).toBe(0)
    expect(d.sfx.names()).toEqual([])
  })
})

describe('AudioDirector: unlock', () => {
  it('plays nothing before the unlock gesture, even when the context already runs', () => {
    const ctx = new FakeAudioContext()
    ctx.state = 'running' // autoplay allowed (desktop engagement, headless Chromium)
    const { d, game } = make(ctx)
    game.emit('ui:tap')
    expect(d.playNamed('buy')).toBe(false)
    expect(ctx.played()).toHaveLength(0)
    expect(d.state().dropped).toBe(0)
    void d.unlock()
    game.emit('ui:tap')
    expect(ctx.played()).toHaveLength(1)
  })

  it('resumes the context and starts Tone synchronously inside the gesture', async () => {
    const { ctx, d } = make()
    const p = d.unlock()
    // no await yet: both calls happened inside the handler
    expect(ctx.resumeCalls).toBe(1)
    expect(tone.starts.count).toBe(1)
    await p
    expect(d.state().unlocked).toBe(true)
    expect(d.state().ctxState).toBe('running')
  })

  it('emits audio:unlocked once, when the unlock gesture has resumed the context (HUD "tap for sound")', async () => {
    const { d, game } = make()
    const seen: unknown[] = []
    game.on('audio:unlocked', (p) => seen.push(p))
    expect(d.state().unlocked).toBe(false)
    const p = d.unlock()
    expect(seen).toHaveLength(0) // the resume has not resolved yet
    await p
    expect(seen).toEqual([{}])
    await d.unlock() // Title shown again (game over → New game): no second event
    expect(seen).toHaveLength(1)
  })
})

describe('AudioDirector: visibility', () => {
  it('on hide: pauses the band, stops the stinger voices, suspends; resumes only on a tap', async () => {
    const doc = new EventTarget()
    vi.stubGlobal('document', doc)
    const { ctx, d, game } = make()
    await d.unlock()
    const stop = vi.spyOn(d.bank as InstrumentBank, 'stop')
    game.emit('hidden')
    expect(stop).toHaveBeenCalledWith(['piano2', 'bass2', 'vibes2', 'trumpet2'])
    expect(ctx.suspendCalls).toBe(1)
    expect(ctx.state).toBe('suspended')
    game.emit('visible')
    expect(ctx.state).toBe('suspended') // nothing on VISIBLE
    doc.dispatchEvent(new Event('pointerup'))
    await Promise.resolve()
    expect(ctx.state).toBe('running')
    expect(d.state().hidden).toBe(false)
  })
})

describe('AudioDirector: loop throttles (audio.md §7)', () => {
  it('stallAlarm: once per 8 s even when the lane stalls, resumes and stalls again', async () => {
    const { d, sim } = await unlocked()
    sim.emit('lane:stalled', { reason: 'shelfFull' })
    expect(played(d, 'stallAlarm')).toBe(1)
    sim.emit('lane:resumed')
    vi.advanceTimersByTime(1000)
    sim.emit('lane:stalled', { reason: 'holdBayFull' })
    expect(played(d, 'stallAlarm')).toBe(1)
    vi.advanceTimersByTime(8000) // the loop's first tick, 9 s after the first alarm
    expect(played(d, 'stallAlarm')).toBe(2)
    vi.advanceTimersByTime(8000)
    expect(played(d, 'stallAlarm')).toBe(3)
    sim.emit('lane:resumed')
    vi.advanceTimersByTime(16000)
    expect(played(d, 'stallAlarm')).toBe(3)
  })

  it('grumble: toggling the district panel never grumbles twice within 20 s', async () => {
    const { d } = await unlocked()
    d.setGrumble(true)
    d.setGrumble(false)
    d.setGrumble(true)
    expect(played(d, 'grumble')).toBe(1)
    vi.advanceTimersByTime(20000)
    expect(played(d, 'grumble')).toBe(2)
  })

  it('hiss: the scanner chain plus the Hold Bay loop stay at one per 4 s', async () => {
    const { d, sim } = await unlocked()
    sim.emit('parcel:flagged', { id: 'p1' })
    sim.emit('parcel:held', { id: 'p1' })
    expect(played(d, 'hiss')).toBe(1)
    vi.advanceTimersByTime(1000)
    sim.emit('parcel:flagged', { id: 'p2' }) // a second ping 1 s later: its hiss is throttled
    expect(played(d, 'scannerPing')).toBe(2)
    expect(played(d, 'hiss')).toBe(1)
    vi.advanceTimersByTime(3000) // loop tick at 4 s
    expect(played(d, 'hiss')).toBe(2)
    sim.emit('parcel:tossed', { id: 'p1', wasMalware: true })
    vi.advanceTimersByTime(8000)
    expect(played(d, 'hiss')).toBe(2)
  })

  it('hiss: a ping just before a loop tick does not double the hiss', async () => {
    const { d, sim } = await unlocked()
    sim.emit('parcel:held', { id: 'p1' }) // loop starts, first tick at 4 s
    vi.advanceTimersByTime(3900)
    sim.emit('parcel:flagged', { id: 'p2' }) // chained hiss at 3.9 s
    expect(played(d, 'hiss')).toBe(1)
    vi.advanceTimersByTime(100) // loop tick 0.1 s later: throttled
    expect(played(d, 'hiss')).toBe(1)
    vi.advanceTimersByTime(4000) // next tick, 4.1 s after the chained hiss
    expect(played(d, 'hiss')).toBe(2)
  })
})

describe('AudioDirector: quests and victory (build 2 M7, design-m7 §6.9)', () => {
  it('quest:offered rings the bell, quest:completed plays questDone', async () => {
    const { d, sim } = await unlocked()
    sim.emit('quest:offered', {
      questId: 'q1',
      templateId: 'rush_district',
      target: 'downtown',
      ultimate: false,
    })
    expect(played(d, 'bell')).toBe(1)
    sim.emit('quest:completed', { questId: 'q1', templateId: 'rush_district' })
    expect(played(d, 'questDone')).toBe(1)
  })

  it('game:victory plays the victory tag (a log line while the stinger set still loads)', async () => {
    const { d, sim } = await unlocked()
    const tag = vi.spyOn(d.stingers, 'victoryTag')
    sim.emit('game:victory', { day: 31 })
    expect(tag).toHaveBeenCalledTimes(1)
    expect(
      d.log
        .entries()
        .some((e) => 'info' in e && /stinger victoryTag skipped/.test(e.info)),
    ).toBe(true)
  })

  it('game:victory drops the playing band out for the tag and brings it back after the hold', async () => {
    const { d, sim } = await unlocked()
    const band = d.band as Band
    vi.spyOn(d.stingers, 'victoryTag').mockReturnValue(true)
    vi.spyOn(d.stingers, 'victoryTagSeconds').mockReturnValue(5)
    const pause = vi.spyOn(band, 'pause')
    const resume = vi.spyOn(band, 'resume')
    tone.T.state = 'started'
    sim.emit('game:victory', { day: 31 })
    expect(pause).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(resume).not.toHaveBeenCalled() // lookAheadS still to go
    vi.advanceTimersByTime(base.config.lookAheadS * 1000 + 1)
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('game:victory leaves the band alone when the tag cannot play', async () => {
    const { d, sim } = await unlocked()
    const band = d.band as Band
    vi.spyOn(d.stingers, 'victoryTag').mockReturnValue(false)
    const pause = vi.spyOn(band, 'pause')
    tone.T.state = 'started'
    sim.emit('game:victory', { day: 31 })
    expect(pause).not.toHaveBeenCalled()
  })
})

describe("Band.nextGrid: stingers land on the band's swung grid", () => {
  it('quantizes to swung 8ths (0.65), beats and swung 16ths at 126 BPM, swing 0.45', () => {
    const ctx = new FakeAudioContext()
    ctx.state = 'running'
    const log = new NoteLog()
    const bank = new InstrumentBank({
      ctx: asContext(ctx),
      loader: {} as never,
      config: base.config,
      destinations: { music: {} as AudioNode, stingers: {} as AudioNode },
      log,
    })
    const band = new Band({
      ctx: asContext(ctx),
      bank,
      bus: {} as AudioNode,
      config: base.config,
      log,
    })
    const sheet = base.sheets['semver-swing']
    if (!sheet) throw new Error('no sheet')
    band.load(sheet, null)
    // audio.md §4.5: tempo, no Tone swing, 4/4, loop over 64 + 4 bars
    expect(tone.T).toMatchObject({
      swing: 0,
      timeSignature: 4,
      loop: true,
      loopStart: 0,
      loopEnd: '68:0:0',
    })
    expect(tone.T.bpm.value).toBe(126)
    const spb = 60 / 126
    // stopped: immediate
    expect(band.nextGrid('8n')).toBe(ctx.currentTime)
    tone.T.state = 'started'
    // 0.3 beats in (the lead of 20 ms included)
    ctx.currentTime = 0.3 * spb - 0.02
    expect(band.nextGrid('8n') / spb).toBeCloseTo(0.65, 9)
    expect(band.nextGrid('4n') / spb).toBeCloseTo(1, 9)
    expect(band.nextGrid('16n') / spb).toBeCloseTo(
      0.25 + (Math.sin(Math.PI / 4) * 0.45) / 3,
      9,
    )
    // just after the swung off-beat: the next beat
    ctx.currentTime = 0.66 * spb - 0.02
    expect(band.nextGrid('8n') / spb).toBeCloseTo(1, 9)
  })
})
