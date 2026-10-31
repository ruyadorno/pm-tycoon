// audio.md §7: the one-shot SFX player — gating, throttles, drop accounting (Node, fake Web Audio).
import { describe, expect, it } from 'vitest'
import { defaultAudioData, SFX_NAMES } from '../../src/audio/data.ts'
import { NoteLog } from '../../src/audio/log.ts'
import { Sfx } from '../../src/audio/sfx.ts'
import { asContext, FakeAudioContext, FakeNode } from './fake-audio.ts'

const data = defaultAudioData()
/** The one-shot sounds of sfx.json: audio.md §7's eighteen + build 2's questDone (design-m7 §6.9). */
const ONE_SHOTS: readonly string[] = SFX_NAMES

function setup(
  o: {
    armed?: boolean
    table?: Record<string, number[]>
    render?: boolean
  } = {},
) {
  const ctx = new FakeAudioContext()
  ctx.state = 'running'
  let now = 0
  let armed = o.armed ?? true
  let dropped = 0
  const log = new NoteLog()
  const sfx = new Sfx({
    ctx: asContext(ctx),
    bus: new FakeNode() as unknown as AudioNode,
    table: o.table ?? data.sfx,
    config: data.config,
    log,
    enabled: () => true,
    armed: () => armed,
    countDrops: () => true,
    onDropped: () => dropped++,
    now: () => now,
  })
  if (o.render !== false) sfx.render()
  return {
    ctx,
    sfx,
    log,
    advance: (ms: number) => (now += ms),
    arm: () => (armed = true),
    dropped: () => dropped,
  }
}

describe('Sfx', () => {
  it('renders exactly the one-shot sounds of audio.md §7 + questDone (ride and hat belong to the band)', () => {
    const { sfx } = setup()
    expect(sfx.names().toSorted()).toEqual([...ONE_SHOTS].toSorted())
    expect(Object.keys(data.sfx).toSorted()).toEqual(
      [...ONE_SHOTS, 'ride', 'hat'].toSorted(),
    )
  })

  it('questDone (build 2 M7): a two-step rising chime, rendered and played on the sfx bus', () => {
    const t = setup()
    const p = data.sfx.questDone as number[]
    // zzfx 1.4.0 order: frequency 660, pitchJump +330 at 0.08 s (the second, higher step), repeatTime 0.16
    expect(p[2]).toBe(660)
    expect(p[10]).toBeGreaterThan(0)
    expect(p[11]).toBeGreaterThan(0)
    expect(t.sfx.has('questDone')).toBe(true)
    expect(t.sfx.play('questDone')).toBe(true)
    expect(t.ctx.played()).toHaveLength(1)
  })

  it('eventPing (build 3, B3 §3.4 / §7): a soft two-note bell, the last one-shot of sfx.json, throttled 2 s', () => {
    const t = setup()
    const p = data.sfx.eventPing as number[]
    // zzfx order: frequency 1320, pitchJump +440 at 0.06 s (the second note)
    expect(p[2]).toBe(1320)
    expect(p[10]).toBeGreaterThan(0)
    expect(p[11]).toBeGreaterThan(0)
    // Appended after the band's hat, so every older sound keeps its order.
    expect(Object.keys(data.sfx).at(-1)).toBe('eventPing')
    expect(SFX_NAMES.at(-1)).toBe('eventPing')
    expect(data.config.throttleMs.eventPing).toBe(2000)
    expect(t.sfx.play('eventPing')).toBe(true)
    t.advance(1999)
    expect(t.sfx.play('eventPing')).toBe(false)
    t.advance(1)
    expect(t.sfx.play('eventPing')).toBe(true)
    expect(t.ctx.played()).toHaveLength(2)
  })

  it('plays nothing before the unlock gesture, even on a running context, and does not count it', () => {
    const t = setup({ armed: false })
    expect(t.sfx.play('tap')).toBe(false)
    expect(t.ctx.played()).toHaveLength(0)
    expect(t.log.sfxEntries().at(-1)).toMatchObject({
      sfx: 'tap',
      dropped: 'locked',
    })
    expect(t.dropped()).toBe(0)
    t.arm()
    expect(t.sfx.play('tap')).toBe(true)
    expect(t.ctx.played()).toHaveLength(1)
  })

  it('never schedules on a suspended context (dropped and counted, not queued)', () => {
    const t = setup()
    t.ctx.state = 'suspended'
    expect(t.sfx.play('buy')).toBe(false)
    expect(t.ctx.played()).toHaveLength(0)
    expect(t.dropped()).toBe(1)
  })

  it('pickup: at most one per 150 ms', () => {
    const t = setup()
    expect(t.sfx.play('pickup')).toBe(true)
    t.advance(149)
    expect(t.sfx.play('pickup')).toBe(false)
    t.advance(1)
    expect(t.sfx.play('pickup')).toBe(true)
  })

  it('honks: one per 3 s across bell, horn and airHorn', () => {
    const t = setup()
    expect(t.sfx.play('airHorn')).toBe(true)
    t.advance(1000)
    expect(t.sfx.play('bell')).toBe(false)
    t.advance(1999)
    expect(t.sfx.play('horn')).toBe(false)
    t.advance(1)
    expect(t.sfx.play('horn')).toBe(true)
  })

  it('a loop tick may use the timer slack but never plays twice inside window - slack', () => {
    const t = setup()
    const slackMs = data.config.throttleSlackMs
    expect(t.sfx.play('stallAlarm')).toBe(true)
    t.advance(8000 - slackMs - 1)
    expect(t.sfx.play('stallAlarm', { slackMs })).toBe(false)
    t.advance(1)
    expect(t.sfx.play('stallAlarm', { slackMs })).toBe(true)
    // without slack the full 8 s applies
    t.advance(8000 - 1)
    expect(t.sfx.play('stallAlarm')).toBe(false)
  })

  it('counts unknown names as dropped (a misspelled ui:sfx shows up in state().dropped)', () => {
    const t = setup()
    expect(t.sfx.play('tapp')).toBe(false)
    expect(t.dropped()).toBe(1)
  })

  it('renders lazily: a sound played before render() renders on demand, bit-identical to the eager render', () => {
    const eager = setup()
    const lazy = setup({ render: false })
    expect(lazy.sfx.names()).toEqual([])
    expect(lazy.sfx.pending()).toHaveLength(ONE_SHOTS.length)
    expect(lazy.sfx.play('buy')).toBe(true)
    expect(lazy.sfx.names()).toEqual(['buy'])
    lazy.sfx.render()
    expect(lazy.sfx.pending()).toEqual([])
    expect(lazy.sfx.names().toSorted()).toEqual(eager.sfx.names().toSorted())
    // each name keeps its table-order seed, so the render order never changes a sample
    for (const name of ONE_SHOTS) {
      const a = eager.sfx.buffer(name)!.getChannelData(0)
      const b = lazy.sfx.buffer(name)!.getChannelData(0)
      expect(b.length, name).toBe(a.length)
      expect(Buffer.from(b.buffer).equals(Buffer.from(a.buffer)), name).toBe(
        true,
      )
    }
    expect(lazy.sfx.renderMs).toBeGreaterThan(0)
  })

  it('a broken entry costs that sound only (render errors are collected, nothing throws)', () => {
    const table = { ...data.sfx, deny: null as unknown as number[] }
    const t = setup({ table })
    expect(t.sfx.errors).toHaveLength(1)
    expect(t.sfx.errors[0]).toMatch(/^sfx deny:/)
    expect(t.sfx.has('deny')).toBe(false)
    expect(t.sfx.play('tap')).toBe(true)
    // tried once: playing it again neither re-renders nor adds an error
    expect(t.sfx.play('deny')).toBe(false)
    expect(t.sfx.errors).toHaveLength(1)
    expect(t.sfx.pending()).toEqual([])
  })
})
