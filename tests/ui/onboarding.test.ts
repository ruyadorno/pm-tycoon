// city-view.md §9.1 / plan.md §9 "Onboarding": three skippable tooltips whose
// progress is persisted in pm.save.v1.onboarding = {step, skipped,
// sawFirstFlag, sawTossHint, wanted} so a reload never repeats a step. M1
// implements steps 1 (Garage) and 3 (rush, 20 s timeout); `step` is the
// highest step done and steps show in tour order.
import { describe, expect, it } from 'vitest'
import {
  completeStep,
  freshOnboarding,
  normaliseOnboarding,
  ONBOARDING_STEPS,
  skipTour,
  STEP_TEXT,
  STEP_TIMEOUT_MS,
  stepEligible,
} from '../../src/ui/Onboarding.ts'

describe('onboarding state (pm.save.v1.onboarding)', () => {
  it('a new game starts with no step done and the full shape', () => {
    expect(freshOnboarding()).toEqual({
      step: 0,
      skipped: false,
      sawFirstFlag: false,
      sawTossHint: false,
      wanted: [],
    })
  })

  it('normalises any stored value into the shape (never throws)', () => {
    expect(normaliseOnboarding(null)).toEqual(freshOnboarding())
    expect(normaliseOnboarding('x')).toEqual(freshOnboarding())
    expect(
      normaliseOnboarding({
        step: 7,
        skipped: true,
        sawFirstFlag: 1,
        sawTossHint: true,
        wanted: ['evil-lodash', 3, 'l0dash'],
      }),
    ).toEqual({
      step: 3,
      skipped: true,
      sawFirstFlag: false,
      sawTossHint: true,
      wanted: ['evil-lodash', 'l0dash'],
    })
    expect(normaliseOnboarding({ step: -2 }).step).toBe(0)
  })
})

describe('§9.1 step order: Garage (1) then rush (3) in M1', () => {
  it('ships steps 1 and 3 with their texts and timeouts', () => {
    expect(ONBOARDING_STEPS).toEqual([1, 3])
    expect(STEP_TEXT[1]).toBe('Buy a bike in the Garage to start delivering')
    expect(STEP_TEXT[3]).toBe(
      'Tap a building with waiting parcels to rush a vehicle there',
    )
    expect(STEP_TIMEOUT_MS[1]).toBeNull()
    expect(STEP_TIMEOUT_MS[3]).toBe(20_000)
  })

  it('step 1 shows on a new game; step 3 only after step 1 is done', () => {
    const s = freshOnboarding()
    expect(stepEligible(s, 1)).toBe(true)
    expect(stepEligible(s, 3)).toBe(false)
    completeStep(s, 1)
    expect(stepEligible(s, 1)).toBe(false)
    expect(stepEligible(s, 3)).toBe(true)
    completeStep(s, 3)
    expect(stepEligible(s, 3)).toBe(false)
    expect(s.step).toBe(3)
  })

  it('a reload never repeats a done step', () => {
    const s = normaliseOnboarding(
      JSON.parse(JSON.stringify(completeStep(freshOnboarding(), 1))),
    )
    expect(stepEligible(s, 1)).toBe(false)
  })

  it('M2 inserting step 2 makes step 3 wait for it', () => {
    const s = completeStep(freshOnboarding(), 1)
    expect(stepEligible(s, 3, [1, 2, 3])).toBe(false)
    completeStep(s, 2)
    expect(stepEligible(s, 3, [1, 2, 3])).toBe(true)
  })

  it('Skip tour clears every step', () => {
    const s = skipTour(freshOnboarding())
    expect(s.skipped).toBe(true)
    for (const k of ONBOARDING_STEPS) expect(stepEligible(s, k)).toBe(false)
  })

  it('completing never lowers the step', () => {
    const s = completeStep(freshOnboarding(), 3)
    completeStep(s, 1)
    expect(s.step).toBe(3)
  })
})
