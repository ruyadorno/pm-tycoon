// ?attract=0 (plan-build2 §4 "URL params", B2 §5): the Title skips the
// attract city for tests that need the old flow; anything else keeps it.
import { describe, expect, it } from 'vitest'
import { parseParams } from '../../src/debug/params.ts'

describe('parseParams: attract', () => {
  it('defaults to the attract Title', () => {
    expect(parseParams('', 1).attract).toBe(true)
    expect(parseParams('?seed=7&debug=1', 1).attract).toBe(true)
  })

  it('?attract=0 / ?attract=false turn it off; other values keep it', () => {
    expect(parseParams('?attract=0', 1).attract).toBe(false)
    expect(parseParams('?attract=false', 1).attract).toBe(false)
    expect(parseParams('?attract=1', 1).attract).toBe(true)
    expect(parseParams('?attract=', 1).attract).toBe(true)
  })
})
