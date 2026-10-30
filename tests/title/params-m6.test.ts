// M6 URL params (design-m6 §8 G): ?policy=delegating picks the delegating
// policy kind (any other truthy ?policy= stays competent), ?level=N asks Boot
// to force level N on a fresh game (null below 2 or when not a number).
import { describe, expect, it } from 'vitest'
import { MIN_FORCED_LEVEL, parseParams } from '../../src/debug/params.ts'

describe('parseParams: policy kind', () => {
  it('?policy=1 is the competent policy', () => {
    const p = parseParams('?policy=1', 1)
    expect(p.policy).toBe(true)
    expect(p.policyKind).toBe('competent')
  })

  it('?policy=delegating turns the policy on with the delegating kind', () => {
    for (const q of ['?policy=delegating', '?policy=Delegating']) {
      const p = parseParams(q, 1)
      expect(p.policy, q).toBe(true)
      expect(p.policyKind, q).toBe('delegating')
    }
  })

  it('no policy / ?policy=0 keeps it off (kind defaults to competent)', () => {
    for (const q of ['', '?policy=0', '?policy=false']) {
      const p = parseParams(q, 1)
      expect(p.policy, q).toBe(false)
      expect(p.policyKind, q).toBe('competent')
    }
  })
})

describe('parseParams: level', () => {
  it('is null when absent, empty, not a number or below 2', () => {
    expect(MIN_FORCED_LEVEL).toBe(2)
    for (const q of [
      '',
      '?level=',
      '?level=x',
      '?level=1',
      '?level=0',
      '?level=-3',
    ])
      expect(parseParams(q, 1).level, q).toBeNull()
  })

  it('reads ?level=N (truncated to an integer)', () => {
    expect(parseParams('?level=2', 1).level).toBe(2)
    expect(parseParams('?level=3&debug=1', 1).level).toBe(3)
    expect(parseParams('?level=4.9', 1).level).toBe(4)
  })
})
