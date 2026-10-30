// warehouse-view.md §3.1 (HoldBayCard lines: label, "S · $20 base", "From
// Cache Cafe (Registry Row) → Node Heights Towers A (Node Heights)",
// "Flagged by: Metal detector (metal)", "Value now $38 · falling",
// "Inspector Audrey"; TOSS / CLEAR 160 × 48; never reveals malware), §3.5
// (CLEAR refused at shelf cap — Q35; "$5 · floor" at the value floor),
// spec §5.3 (decay while held), §5.4 (reading the label is the skill);
// design-m6 §6.2 / spec-build2 §2.6 (the sorter's hint "Pat: looks clean
// (85%)" under the label, +20 px → 268; line 6 names the flagging inspector;
// opening the card touches the parcel, D3). Pure helpers + a headless Sim;
// Phaser is stubbed.
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => {
  class Stub {
    readonly stub = true
  }
  return {
    default: {
      Scene: Stub,
      GameObjects: { Container: Stub, NineSlice: Stub, Image: Stub },
      Geom: { Rectangle: Stub },
    },
  }
})

const hb = await import('../../src/ui/warehouse/HoldBayCard.ts')
const bs = await import('../../src/ui/warehouse/BuySheet.ts')
const { computeLayout, HUD_TOP_H } = await import('../../src/ui/layout.ts')
const { dataFixture, fund, heldParcel, quietSim, standardApplicant } =
  await import('../sim/helpers.ts')
const { TICKS_PER_S } = await import('../../src/sim/types.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')

const data = dataFixture()
const S = data.parcels.sizes.S.value
const M = data.parcels.sizes.M.value
const { graceS, floorAtS } = data.parcels.decay

/** A parcel spawned at tick 0, viewed `s` sim seconds later. */
const parcel = (base: number) => ({
  spawnedTick: 0,
  baseValue: base,
  mult: 1,
  lockedValue: null,
})
const at = (s: number) => Math.round(s * TICKS_PER_S)

describe('§3.1 card lines', () => {
  it('route: building names + district flavour names', () => {
    expect(hb.routeLine(data, 'dt_cache_cafe', 'hr_towers_a')).toBe(
      'From Cache Cafe (Registry Row) → Node Heights Towers A (Node Heights)',
    )
  })

  it('size + base: "S · $20 base"', () => {
    expect(hb.sizeLine({ size: 'S', baseValue: S, mult: 1 })).toBe(
      'S · $20 base',
    )
  })

  it('"Flagged by: Metal detector (metal)"', () => {
    expect(hb.flaggedByLine('Metal detector', 'metal')).toBe(
      'Flagged by: Metal detector (metal)',
    )
    expect(hb.flaggedByLine('Inspection desk', null)).toBe(
      'Flagged by: Inspection desk',
    )
  })

  it('desk flags name the crew: "Inspector Audrey"', () => {
    expect(hb.crewLine(['Audrey'])).toBe('Inspector Audrey')
    expect(hb.crewLine(['Audrey', 'Lin'])).toBe('Inspectors Audrey and Lin')
    expect(hb.crewLine([])).toBeNull()
  })
})

describe('§5.3 value now (keeps decaying while held)', () => {
  it('inside the grace window the value is whole and the countdown shows', () => {
    const v = hb.valueNow(data, parcel(S), at(0))
    expect(v.text).toBe(`Value now $20 · drops in 1:30`)
    expect(v.phase).toBe('grace')
    expect(graceS).toBe(90)
  })

  it('"Value now $38 · falling" for an M parcel 134 s old', () => {
    const v = hb.valueNow(data, parcel(M), at(134))
    expect(v.text).toBe('Value now $38 · falling')
    expect(v.phase).toBe('falling')
  })

  it('§3.5 at the floor: "Value now $5 · floor" (nothing expires)', () => {
    expect(hb.valueNow(data, parcel(S), at(floorAtS)).text).toBe(
      'Value now $5 · floor',
    )
    expect(hb.valueNow(data, parcel(S), at(floorAtS * 10)).text).toBe(
      'Value now $5 · floor',
    )
  })

  it('the coin ring drains 0 → 8 and stays on the last frame at the floor', () => {
    expect(hb.ringIndex(data, parcel(S), at(0))).toBe(0)
    expect(hb.ringIndex(data, parcel(S), at(graceS))).toBe(0)
    const mid = (graceS + floorAtS) / 2
    expect(hb.ringIndex(data, parcel(S), at(mid))).toBe(4)
    expect(hb.ringIndex(data, parcel(S), at(floorAtS))).toBe(8)
    expect(hb.ringIndex(data, parcel(S), at(floorAtS * 3))).toBe(8)
  })
})

describe('§3.5 / Q35 CLEAR is refused at shelf cap; TOSS always works', () => {
  it('"Shelf full" at or past the cap, none below', () => {
    expect(hb.clearBlockReason(30, 30)).toBe('Shelf full')
    expect(hb.clearBlockReason(33, 30)).toBe('Shelf full')
    expect(hb.clearBlockReason(29, 30)).toBeNull()
  })
})

describe('§5.4 the card never says whether the parcel is malware', () => {
  it('a specialised machine shows its own strain, never the parcel strain', () => {
    // A Metal detector catching rattle malware via pOther must read the same
    // as its own decoy false flag: "(metal)".
    expect(hb.shownTrait({ strain: 'metal' })).toBe('metal')
    expect(hb.shownTrait({ strain: 'rattle' })).toBe('rattle')
  })

  it('generalists (desk, X-ray) and removed checkers show no trait: a decoy trait of an unannounced strain would mark the parcel clean', () => {
    expect(hb.shownTrait({ strain: 'any' })).toBeNull()
    expect(hb.shownTrait(null)).toBeNull()
    expect(
      hb.flaggedByLine('Inspection desk', hb.shownTrait({ strain: 'any' })),
    ).toBe('Flagged by: Inspection desk')
  })

  it('malware and its decoy twin produce identical card lines (apart from the label)', () => {
    const base = {
      spawnedTick: 0,
      baseValue: S,
      mult: 1,
      lockedValue: null,
      size: 'S' as const,
    }
    // The parcel's own flagged strain is not an input of any card line.
    const lines = (name: string, checkerStrain: 'metal' | 'any') => [
      hb.sizeLine(base),
      hb.routeLine(data, 'dt_cache_cafe', 'hr_towers_a'),
      hb.flaggedByLine(name, hb.shownTrait({ strain: checkerStrain })),
      hb.valueNow(data, base, at(120)).text,
    ]
    // malware (rattle, caught on pOther) vs a clean decoy (metal trait)
    expect(lines('Metal detector', 'metal')[2]).toBe(
      'Flagged by: Metal detector (metal)',
    )
    // desk: metal malware vs a battery decoy read the same
    expect(lines('Inspection desk', 'any')[2]).toBe(
      'Flagged by: Inspection desk',
    )
  })
})

describe('§3.1 card geometry', () => {
  it('TOSS / CLEAR are 160 × 48 side by side inside 360 px', () => {
    expect(hb.ACTION_W).toBe(160)
    expect(hb.ACTION_H).toBe(48)
    expect(2 * hb.ACTION_W + hb.ACTION_GAP).toBeLessThanOrEqual(
      360 - 2 * bs.PAD,
    )
  })

  it('the 248-px card fits under the HUD top band at 360 × 604', () => {
    const L = computeLayout(360, 604, 0, 0, 1)
    expect(bs.sheetBottom(L) - hb.HOLD_CARD_H).toBeGreaterThanOrEqual(HUD_TOP_H)
    expect(hb.CAPTION_Y + 14).toBeLessThanOrEqual(hb.HOLD_CARD_H)
  })
})

describe('design-m6 §6.2 the sorter hint and the flagging inspector', () => {
  it('"Pat: looks clean (85%)" from the sorter tag', () => {
    expect(hb.sorterHintLine({ name: 'Pat', pct: 85 })).toBe(
      'Pat: looks clean (85%)',
    )
    expect(hb.sorterHintLine({ name: 'Rae', pct: 70 })).toBe(
      'Rae: looks clean (70%)',
    )
  })

  it('line 6 names the one inspector whose roll flagged it', () => {
    expect(hb.inspectorLine('Lin')).toBe('Inspector Lin')
    expect(hb.inspectorLine(null)).toBeNull()
  })

  it('the hint adds one 20-px line: 248 → 268, every line below moves down 20', () => {
    const plain = hb.holdCardLayout(false)
    const hint = hb.holdCardLayout(true)
    expect(plain).toMatchObject({
      h: 248,
      hintY: null,
      routeY: hb.ROUTE_Y,
      actionsY: hb.ACTIONS_Y,
      captionY: hb.CAPTION_Y,
    })
    expect(hint.h).toBe(268)
    expect(hb.HOLD_CARD_HINT_H).toBe(268)
    for (const k of [
      'routeY',
      'flagY',
      'valueY',
      'crewY',
      'actionsY',
      'captionY',
    ] as const)
      expect(hint[k] - plain[k]).toBe(20)
    // the hint band sits between the size line (y 36..52) and the route
    expect(hint.hintY).toBeGreaterThanOrEqual(52)
    expect((hint.hintY ?? 0) + hb.HINT_LINE_H).toBeLessThanOrEqual(hint.routeY)
  })

  it('the 268-px card still fits under the HUD top band at 360 × 604', () => {
    const L = computeLayout(360, 604, 0, 0, 1)
    expect(bs.sheetBottom(L) - hb.HOLD_CARD_HINT_H).toBeGreaterThanOrEqual(
      HUD_TOP_H,
    )
    const hint = hb.holdCardLayout(true)
    expect(hint.captionY + 14).toBeLessThanOrEqual(hint.h)
  })

  it('the facade item carries the tag and the flagging inspector; touch marks the parcel', () => {
    const sim = fund(quietSim(1))
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 2 }).ok).toBe(true)
    const a = standardApplicant(sim, 'sorter')
    const hired = sim.dispatch({
      kind: 'hire',
      role: 'sorter',
      applicantId: a.id,
      target: { station: 'hold' },
    })
    if (!hired.ok || hired.employeeId === undefined) throw new Error('hire')
    const p = heldParcel(sim, { malware: false })
    p.sorted = { by: hired.employeeId, name: a.name, pct: 85 }
    p.trace.push({
      tick: sim.state.tick,
      what: 'flagged',
      ref: 'slot1',
      text: 'Slot 1 desk — Audrey: flagged (metal)',
      by: 1,
      who: 'Audrey',
    })
    const vs = createViewSim(sim)
    const item = vs.holdBay.items.find((i) => i.parcelId === p.id)
    expect(item?.sorted).toEqual({ name: a.name, pct: 85 })
    expect(item?.inspectorName).toBe('Audrey')
    expect(item?.checkerName).toBe('Inspection desk')
    expect(hb.sorterHintLine(item!.sorted!)).toBe(
      `${a.name}: looks clean (85%)`,
    )
    // HoldBayCard.open dispatches this (design D3)
    expect(vs.holdBay.touch(p.id)).toEqual({ ok: true })
    expect(sim.state.parcels[String(p.id)]?.touchedTick).toBe(sim.state.tick)
    expect(vs.holdBay.touch(999_999)).toEqual({ ok: false, reason: 'invalid' })
  })
})
