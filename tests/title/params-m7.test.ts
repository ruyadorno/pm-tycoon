// M7 URL params (design-m7 §6.10, plan-build2 §8.4 task 6): ?quest=<id> asks
// Boot to offer that quest template (debug.offerQuest) on a fresh game; null
// when absent or blank. The id is passed through as written (trimmed): the
// sim refuses an unknown one and Boot warns.
import { describe, expect, it } from 'vitest'
import { parseParams } from '../../src/debug/params.ts'

describe('parseParams: quest', () => {
  it('is null when absent or blank', () => {
    for (const q of ['', '?quest=', '?quest=%20%20', '?seed=7&debug=1'])
      expect(parseParams(q, 1).quest, q).toBeNull()
  })

  it('reads ?quest=<templateId> (trimmed, case kept)', () => {
    expect(parseParams('?quest=rush_district', 1).quest).toBe('rush_district')
    expect(
      parseParams('?seed=7&debug=1&quest=magic_parcel&level=2', 1).quest,
    ).toBe('magic_parcel')
    expect(parseParams('?quest=%20golden_release%20', 1).quest).toBe(
      'golden_release',
    )
    expect(parseParams('?quest=Nope', 1).quest).toBe('Nope')
  })

  it('leaves the other params alone', () => {
    const a = parseParams('?seed=7&level=2&policy=1', 1)
    const b = parseParams('?seed=7&level=2&policy=1&quest=cheer_up', 1)
    expect({ ...b, quest: null }).toEqual(a)
  })
})
