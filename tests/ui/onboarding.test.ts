// city-view.md §9.1 / plan.md §9 "Onboarding": three skippable tooltips whose
// progress is persisted in pm.save.v2.onboarding = {step, skipped,
// sawFirstFlag, sawTossHint} so a reload never repeats a step. Steps 1
// (Garage — M6: `Buy a bike in the Garage and pick its driver`), 2
// (warehouse hint, computed from the data, 45 s) and 3 (rush, 20 s timeout);
// `step` is the highest step done and steps show in tour order. §9.2: the
// scripted-flag texts. The wanted list moved into the sim at M6
// (spec-build2 §2.8): an old stored `wanted` is dropped.
import { describe, expect, it } from 'vitest'
import {
  completeStep,
  FIRST_FLAG_CITY_TEXT,
  FIRST_FLAG_ROOM_TEXT,
  FLAG_FOLLOW_TEXT,
  firstFlagText,
  isFlagFunnelText,
  freshOnboarding,
  normaliseOnboarding,
  ONBOARDING_STEPS,
  skipTour,
  STEP2_DELAY_MS,
  step2Model,
  step2Text,
  STEP_TEXT,
  startInspectorP,
  step1Done,
  step1Text,
  STEP_TIMEOUT_MS,
  stepEligible,
} from '../../src/ui/Onboarding.ts'
import { dataFixture } from '../sim/helpers.ts'

describe('onboarding state (pm.save.v2.onboarding)', () => {
  it('a new game starts with no step done and the full shape', () => {
    expect(freshOnboarding()).toEqual({
      step: 0,
      skipped: false,
      sawFirstFlag: false,
      sawTossHint: false,
      sawVictory: false,
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
        sawVictory: 'yes',
        wanted: ['evil-lodash', 3, 'l0dash'],
      }),
    ).toEqual({
      step: 3,
      skipped: true,
      sawFirstFlag: false,
      sawTossHint: true,
      sawVictory: false,
    })
    // Review sim-2: Continue on the VictoryCard is remembered.
    expect(normaliseOnboarding({ sawVictory: true }).sawVictory).toBe(true)
    // An M12 save (no sawVictory) normalises to not seen.
    expect(
      normaliseOnboarding({
        step: 3,
        skipped: false,
        sawFirstFlag: true,
        sawTossHint: true,
      }).sawVictory,
    ).toBe(false)
    expect(normaliseOnboarding({ step: -2 }).step).toBe(0)
  })
})

describe('§9.1 step order: Garage (1), warehouse (2), rush (3)', () => {
  it('ships steps 1-3 with their texts and timeouts', () => {
    expect(ONBOARDING_STEPS).toEqual([1, 2, 3])
    expect(STEP_TIMEOUT_MS[2]).toBe(45_000)
    expect(STEP2_DELAY_MS).toBe(3_000)
    expect(STEP_TEXT[1]).toBe('Buy a bike in the Garage and pick its driver')
    expect(STEP_TEXT[3]).toBe(
      'Tap a building with waiting parcels to rush a vehicle there',
    )
    expect(STEP_TIMEOUT_MS[1]).toBeNull()
    expect(STEP_TIMEOUT_MS[3]).toBe(20_000)
  })

  it('M6 review: step 1 is done once a vehicle has a driver, not on a `Hire later` purchase — then it says so', () => {
    expect(step1Done([])).toBe(false)
    expect(step1Text([])).toBe(STEP_TEXT[1])
    const later = [{ name: 'Bike 1', driverId: null }]
    expect(step1Done(later)).toBe(false)
    expect(step1Text(later)).toBe(
      'Bike 1 has no driver yet: hire one in the Garage',
    )
    const driven = [...later, { name: 'Bike 2', driverId: 4 }]
    expect(step1Done(driven)).toBe(true)
    expect(step1Text(driven)).toBe(STEP_TEXT[1])
  })

  it('step 1 shows on a new game; 2 after 1; 3 after 2', () => {
    const s = freshOnboarding()
    expect(stepEligible(s, 1)).toBe(true)
    expect(stepEligible(s, 2)).toBe(false)
    expect(stepEligible(s, 3)).toBe(false)
    completeStep(s, 1)
    expect(stepEligible(s, 1)).toBe(false)
    expect(stepEligible(s, 2)).toBe(true)
    expect(stepEligible(s, 3)).toBe(false)
    completeStep(s, 2)
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

  it('step 3 waits for step 2', () => {
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

describe('§9.1 step 2: the detection hint comes from the data and §6.3', () => {
  const data = dataFixture()

  it('inspector 85%, Metal detector $150, lane 97% (1 − 0.15 × 0.20)', () => {
    expect(step2Model(data)).toEqual({
      strain: 'metal',
      inspectorPct: 85,
      machineId: 'metal_detector',
      machineName: 'Metal detector',
      price: 150,
      lanePct: 97,
    })
    expect(step2Text(data)).toBe(
      'Your inspector catches 85% by hand. A Metal detector ($150) lifts the lane to 97%',
    )
  })

  it('M6: the start inspector is Audrey 3/3/0 — roles.inspector.p at eye 3 = 0.85', () => {
    expect(data.employees.start.inspector.pips.eye).toBe(3)
    expect(startInspectorP(data)).toBe(0.85)
  })

  it('follows the tables, never literals', () => {
    const patched = dataFixture({
      employees: { roles: { inspector: { p: [0.75, 0.8, 0.5] } } },
      machines: { checkers: [{ price: 175 }] },
    })
    expect(step2Text(patched)).toBe(
      'Your inspector catches 50% by hand. A Metal detector ($175) lifts the lane to 90%',
    )
    // A 1-eye start inspector reads p[0].
    const oneEye = dataFixture({
      employees: { start: { inspector: { pips: { eye: 1 } } } },
    })
    expect(step2Model(oneEye)?.inspectorPct).toBe(75)
    expect(step2Model(oneEye)?.lanePct).toBe(95)
  })
})

describe('§9.2: the scripted first flag', () => {
  it('toasts `A parcel flagged — Toss it. Lives: 3` and a 10-s follow-up', () => {
    expect(firstFlagText(3)).toBe('A parcel flagged — Toss it. Lives: 3')
    expect(FLAG_FOLLOW_TEXT).toBe(
      'Parcels pile up while a flagged one waits — open the warehouse',
    )
  })
})

describe('§9.2 funnel: the first flag of a run, scripted or not', () => {
  it('a non-scripted first flag (usually a decoy) gets neutral wording, never "Toss it"', () => {
    expect(FIRST_FLAG_CITY_TEXT).toBe(
      'A parcel was flagged — open the warehouse to Toss or Clear it',
    )
    expect(FIRST_FLAG_ROOM_TEXT).toBe(
      'Flagged parcels wait in the Hold Bay — tap one to Toss or Clear it',
    )
    for (const t of [FIRST_FLAG_CITY_TEXT, FIRST_FLAG_ROOM_TEXT]) {
      expect(t).not.toMatch(/Toss it/)
      expect(t).toMatch(/Toss or Clear/)
    }
  })

  it('the funnel toasts are recognised (a Toss or the room hint replaces them), other toasts are not', () => {
    expect(isFlagFunnelText(firstFlagText(3), 3)).toBe(true)
    expect(isFlagFunnelText(firstFlagText(2), 3)).toBe(false)
    expect(isFlagFunnelText(FLAG_FOLLOW_TEXT, 3)).toBe(true)
    expect(isFlagFunnelText(FIRST_FLAG_CITY_TEXT, 3)).toBe(true)
    expect(isFlagFunnelText(FIRST_FLAG_ROOM_TEXT, 3)).toBe(true)
    expect(isFlagFunnelText('Payday — payroll -$28', 3)).toBe(false)
    expect(isFlagFunnelText(null, 3)).toBe(false)
  })
})
