// audio.md §7: the one-shot SFX player — gating, throttles, drop accounting (Node, fake Web Audio).
import { describe, expect, it } from 'vitest'
import { defaultAudioData, SFX_NAMES } from '../../src/audio/data.ts'
import { NoteLog } from '../../src/audio/log.ts'
import { Sfx } from '../../src/audio/sfx.ts'
import { asContext, FakeAudioContext, FakeNode } from './fake-audio.ts'

const data = defaultAudioData()

function setup(o: { armed?: boolean; table?: Record<string, number[]> } = {}) {
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
  sfx.render()
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
  it('renders exactly the 18 one-shot sounds of audio.md §7 (ride and hat belong to the band)', () => {
    const { sfx } = setup()
    expect(sfx.names().toSorted()).toEqual([...SFX_NAMES].toSorted())
    expect(Object.keys(data.sfx).toSorted()).toEqual(
      [...SFX_NAMES, 'ride', 'hat'].toSorted(),
    )
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

  it('a broken entry costs that sound only (render errors are collected, nothing throws)', () => {
    const table = { ...data.sfx, deny: null as unknown as number[] }
    const t = setup({ table })
    expect(t.sfx.errors).toHaveLength(1)
    expect(t.sfx.errors[0]).toMatch(/^sfx deny:/)
    expect(t.sfx.has('deny')).toBe(false)
    expect(t.sfx.play('tap')).toBe(true)
  })
})
