// M2 HUD rules (city-view.md §3.3, §4.1, §8.1, §9.1-§9.2; plan.md §5
// localStorage keys): the bomb-slot fuse on a lost life (the rightmost lit
// slot fuses 400 ms, puffs, empties), the stall / incident ticker lines and
// the registry accessor the warehouse's wanted poster reads.
import { describe, expect, it } from 'vitest'
import { getOnboarding, REG_ONBOARDING } from '../../src/boot/autosave.ts'
import {
  FUSE_STEP_MS,
  FUSE_STEPS,
  fusingSlot,
  lifeFrames,
} from '../../src/ui/LivesRow.ts'
import { freshOnboarding } from '../../src/ui/Onboarding.ts'
import { defusedLine, incidentLine, stallLine } from '../../src/ui/Ticker.ts'

describe('city-view §3.3 step 3: the rightmost lit bomb slot fuses then empties', () => {
  it('3 → 2 lives fuses slot 3 (index 2); slots 4-5 stay outlines', () => {
    expect(fusingSlot(2, 3)).toBe(2)
    expect(lifeFrames(2)).toEqual([
      'ic_life_on',
      'ic_life_on',
      'ic_life_off',
      'ic_life_off',
      'ic_life_off',
    ])
  })

  it('nothing fuses when no lit slot is lost', () => {
    expect(fusingSlot(3, 3)).toBeNull()
    expect(fusingSlot(4, 3)).toBeNull()
    expect(fusingSlot(-1, 0)).toBeNull()
    expect(fusingSlot(5, 6)).toBeNull()
  })

  it('the fuse burns 400 ms (2 frames), then a 4-frame puff over the empty slot', () => {
    const fuse = FUSE_STEPS.filter((s) => s.puff === null)
    expect(fuse.length * FUSE_STEP_MS).toBe(400)
    expect(new Set(fuse.map((s) => s.slot))).toEqual(
      new Set(['ic_life_fuse_0', 'ic_life_fuse_1']),
    )
    const puff = FUSE_STEPS.filter((s) => s.puff !== null)
    expect(puff.map((s) => s.puff)).toEqual([
      'fx_puff_f0',
      'fx_puff_f1',
      'fx_puff_f2',
      'fx_puff_f3',
    ])
    expect(puff.every((s) => s.slot === 'ic_life_off')).toBe(true)
  })
})

describe('city-view §3.2 / §8.1: stall and incident ticker lines', () => {
  it('spec §6.4: "Warehouse backed up — Hold Bay full" (shelf full variant)', () => {
    expect(stallLine('holdBayFull')).toBe('Warehouse backed up — Hold Bay full')
    expect(stallLine('shelfFull')).toBe('Warehouse backed up — shelf full')
    expect(stallLine('bufferFull')).toBe('Warehouse backed up — lane jammed')
  })

  it('"Close call! evil-lodash defused at the warehouse"', () => {
    expect(defusedLine('evil-lodash')).toBe(
      'Close call! evil-lodash defused at the warehouse',
    )
  })

  it('"Malware delivered to Async Arms — 2 lives left"', () => {
    expect(incidentLine('Async Arms', 2)).toBe(
      'Malware delivered to Async Arms — 2 lives left',
    )
    expect(incidentLine('Async Arms', 1)).toBe(
      'Malware delivered to Async Arms — 1 life left',
    )
    expect(incidentLine('Async Arms', 0)).toBe(
      'Malware delivered to Async Arms — no lives left',
    )
  })
})

function registry(): {
  get(k: string): unknown
  set(k: string, v: unknown): unknown
} {
  const m = new Map<string, unknown>()
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: unknown) => m.set(k, v),
  }
}

describe('plan.md §5: pm.save.v1.onboarding lives in the game registry', () => {
  it('getOnboarding returns the one shared object (mutations persist)', () => {
    const reg = registry()
    const ob = freshOnboarding()
    reg.set(REG_ONBOARDING, ob)
    expect(getOnboarding(reg)).toBe(ob)
    getOnboarding(reg).wanted.push('evil-lodash')
    expect(ob.wanted).toEqual(['evil-lodash'])
  })

  it('replaces a missing or malformed value with a normalised one', () => {
    const reg = registry()
    const a = getOnboarding(reg)
    expect(a).toEqual(freshOnboarding())
    expect(reg.get(REG_ONBOARDING)).toBe(a)
    reg.set(REG_ONBOARDING, { step: 2, wanted: 'x' })
    const b = getOnboarding(reg)
    expect(b.step).toBe(2)
    expect(b.wanted).toEqual([])
    expect(reg.get(REG_ONBOARDING)).toBe(b)
  })
})
