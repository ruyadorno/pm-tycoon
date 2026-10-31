// Warehouse M9 (spec-build2 §4.2-§4.4, §6.6; design-m8-m9 §6.1, §6.4, R2,
// R21; plan-build2 §8.6 tasks 1-3): the pure halves of the L4 / L5 room —
// every tier-4 / tier-5 frame the room draws is packed in the atlas its
// layer binds (floors, walls, wall faces, signs, shelves, posters, props,
// the neon strips; the Sorter Arm and the X-ray packed into both), the
// strip-light spots turn neon at tier 5, the ext strip's tooltip for the
// one slot left past the column (`Slot 6 — unlocks at Lv 5`), the X-ray
// row in the BuySheet at the real L4 (shipped cap 5: no "coming soon"),
// and the StationCard's Arm state with its `sorter_arm_f0` picture at the
// card's top right. Build 3 M12 (B3 §3.5, D-M12-13): the shelf tooltip's
// `(+N)` for a `cap` card's bonus, kept through a level-up. Phaser is
// stubbed (the modules import the UI kit).
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

const lr = await import('../../src/render/warehouse/LaneRenderer.ts')
const rl = await import('../../src/render/warehouse/RoomLayout.ts')
const ws = await import('../../src/scenes/WarehouseScene.ts')
const bs = await import('../../src/ui/warehouse/BuySheet.ts')
const st = await import('../../src/ui/warehouse/StationCard.ts')
const { HANDLE_W, HANDLE_Y, HANDLE_H } = await import('../../src/ui/Sheet.ts')
const { computeLayout, HUD_TOP_H } = await import('../../src/ui/layout.ts')
const { FRAME_ATLAS, FRAMES, SHARED_FRAMES } =
  await import('../../src/render/frames.generated.ts')
const { dataFixture, fund, makeSim } = await import('../sim/helpers.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { SORTER_ARM_ID } = await import('../../src/sim/systems/sorter.ts')
const { applyModifier } = await import('../../src/sim/systems/modifierOps.ts')

const data = dataFixture()
const atlasOf = (f: string): string | undefined =>
  (FRAME_ATLAS as Record<string, string>)[f]
const packed = (f: string): boolean =>
  (FRAMES as Record<string, string>)[f] !== undefined

describe('B2 §6.6 / design-m8-m9 §6.4 (M9): the tier-4 and tier-5 room art', () => {
  it('L4 is tier 4, L5 tier 5 (levels.json); every tier frame resolves to its own tier', () => {
    expect(lr.visualTier(data, 4)).toBe(4)
    expect(lr.visualTier(data, 5)).toBe(5)
    for (const t of [4, 5]) {
      for (const stem of [
        'wall',
        'wallface',
        'sign',
        'shelf',
        'wanted_poster',
        'props',
      ])
        expect(lr.tierFrame(stem, t), `${stem} t${t}`).toBe(`${stem}_t${t}`)
      expect(lr.floorFrameFor(t, 4, 9)).toBe(`floor_t${t}_lane`)
      expect(lr.floorFrameFor(t, 6, 9)).toBe(`floor_t${t}`)
    }
  })

  it('the back-layer frames of tiers 4–5 are packed in `interior`; the Arm and the X-ray in both atlases', () => {
    const back: string[] = ['neon_strip_f0', 'neon_strip_f1']
    for (const t of [4, 5])
      for (const stem of [
        'floor',
        'wall',
        'wallface',
        'sign',
        'shelf',
        'wanted_poster',
        'props',
      ])
        back.push(`${stem}_t${t}`)
    back.push('floor_t4_lane', 'floor_t5_lane')
    for (const f of back) {
      expect(packed(f), f).toBe(true)
      expect(atlasOf(f) === 'interior' || SHARED_FRAMES.has(f), f).toBe(true)
    }
    // The Arm: a back-layer fixture in the room (interior copy) and the
    // StationCard's picture (src/ui/**, world-bound) — packed into both.
    for (const f of ['sorter_arm_f0', 'sorter_arm_f1', 'sorter_arm_f2']) {
      expect(packed(f), f).toBe(true)
      expect(SHARED_FRAMES.has(f), f).toBe(true)
    }
    // The X-ray: a machine in the room's front layer and the BuySheet row.
    for (const f of ['xray_f0', 'xray_f1']) {
      expect(packed(f), f).toBe(true)
      expect(atlasOf(f), f).toBe('world')
    }
  })

  it('tier 5 swaps the strip lights for the neon tubes (`_f1` = the flicker), falling back while the art is missing', () => {
    for (const t of [2, 3, 4]) expect(lr.stripFrame(t)).toBe('strip_light')
    expect(lr.stripFrame(5)).toBe('neon_strip_f0')
    expect(lr.stripFrame(5, true)).toBe('neon_strip_f1')
    expect(lr.stripFrame(5, true, (n) => n === 'neon_strip_f0')).toBe(
      'neon_strip_f0',
    )
    expect(lr.stripFrame(5, false, () => false)).toBe('strip_light')
    expect(lr.tierParts(5).neon).toBe(true)
    expect(lr.tierParts(4).neon).toBe(false)
  })
})

describe('design-m8-m9 §6.1 (M9): the slots past the belt column', () => {
  it('ext tooltip: two slots read `Slots 5–6 — unlock at …`, the one left at tier 4 `Slot 6 — unlocks at Lv 5`', () => {
    expect(
      ws.extTooltip(data, [
        { id: 'slot5', level: 4 },
        { id: 'slot6', level: 5 },
      ]),
    ).toBe('Slots 5–6 — unlock at Lv 4 and Lv 5')
    expect(ws.extTooltip(data, [{ id: 'slot6', level: 5 }])).toBe(
      'Slot 6 — unlocks at Lv 5',
    )
    const cap3 = dataFixture({ economy: { playtestMaxLevel: 3 } })
    expect(ws.extTooltip(cap3, [{ id: 'slot6', level: 5 }])).toBe(
      'Slot 6 — unlocks at Lv 5 · coming soon',
    )
    expect(ws.lockedSlotTooltip(data, 'Slot 6', 5)).toBe(
      'Slot 6 — unlocks at Lv 5',
    )
  })

  it('the live slots of L4 / L5 are the belt slots of their tier (none is left in the ext strip)', () => {
    for (const level of [4, 5]) {
      const sim = makeSim(2)
      expect(sim.dispatch({ kind: 'debugForceLevel', level })).toEqual({
        ok: true,
      })
      const lay = new rl.FixedLaneLayout(lr.visualTier(data, level))
      const live = sim.state.lane.nodes.filter(
        (n) => n.kind === 'slot' && !n.locked,
      )
      expect(live).toHaveLength(level === 4 ? 5 : 6)
      for (const n of live) expect(lay.isBeltSlot(n.id), n.id).toBe(true)
      const lockedExt = sim.state.lane.nodes.filter(
        (n) => n.kind === 'slot' && n.locked && !lay.isBeltSlot(n.id),
      )
      expect(lockedExt.map((n) => n.id)).toEqual(level === 4 ? ['slot6'] : [])
    }
  })
})

describe('B2 §4.2 (M9): the X-ray in the BuySheet at the real L4', () => {
  it('unlocked at L4 with its art and stats, the sheet still fits 360 × 604', () => {
    expect(data.economy.playtestMaxLevel).toBe(5)
    const l3 = bs.buyRows(data, 3, [])
    expect(l3.find((r) => r.id === 'xray')?.lines[1]).toBe(
      '30/min · Unlocks at Lv 4',
    )
    const rows = bs.buyRows(data, 4, [])
    const xray = rows.find((r) => r.id === 'xray')
    expect(xray).toMatchObject({
      kind: 'machine',
      name: 'X-ray',
      locked: false,
      priceText: '$1,000',
      lines: ['catch 70% any strain · false-flag 25%', '30/min'],
    })
    expect(rows.every((r) => !r.locked)).toBe(true)
    expect(bs.machineFrame('xray')).toBe('xray_f0')
    const L = computeLayout(360, 604, 0, 0, 1)
    const top = bs.sheetBottom(L) - bs.buySheetHeight(rows.length)
    expect(top).toBeGreaterThanOrEqual(HUD_TOP_H)
    // A funded L4 lane takes it in slot 5 (the new belt slot).
    const sim = makeSim(4)
    sim.dispatch({ kind: 'debugForceLevel', level: 4 })
    fund(sim, 10_000)
    const vs = createViewSim(sim)
    expect(vs.lane.buyMachine('xray', 'slot5')).toEqual({ ok: true })
    const lay = new rl.FixedLaneLayout(4)
    expect(lay.machineAt('slot5')).toEqual({ x: 120, y: 352 + 16 })
  })
})

describe('design-m8-m9 §6.1 (M9): the StationCard shows the Sorter Arm', () => {
  it('Buy Sorter Arm $600 opens at the real L4 cap (no "coming soon"), the Arm state after buying', () => {
    const arm = st.armDef(data)
    expect(arm).not.toBeNull()
    if (!arm) return
    expect(st.armBlockReason(data, arm, 3, 1_000_000)).toBe('Unlocks at Lv 4')
    expect(st.armBlockReason(data, arm, 4, 1_000_000)).toBeNull()
    expect(st.armCaption(arm, 4, 1_000_000)).toBeNull()
    const sim = makeSim(6)
    sim.dispatch({ kind: 'debugForceLevel', level: 4 })
    fund(sim, 10_000)
    const vs = createViewSim(sim)
    expect(st.stationModel(data, vs.holdStation).buttons).toEqual([
      'Hire a sorter',
      'Buy Sorter Arm $600',
    ])
    expect(vs.lane.buyMachine(SORTER_ARM_ID, 'hold')).toEqual({ ok: true })
    expect(vs.holdStation.kind).toBe('sorter_arm')
    const m = st.stationModel(data, vs.holdStation)
    expect(m.state).toBe('arm')
    expect(m.lines).toEqual([
      'Sorter Arm · tosses every held parcel after 3 s',
      'Clear a parcel first to keep it',
    ])
    expect(m.buttons).toEqual(['Remove +$300'])
  })

  it('the Arm picture: `sorter_arm_f0` at the card top right, clear of the drag handle and the body lines, inside the card', () => {
    for (const W of [360, 393, 430]) {
      const a = st.armArt(W)
      expect(a).toEqual({ frame: 'sorter_arm_f0', x: W - 8 - 64, y: 4 })
      if (!a) continue
      const pic = { x: a.x, y: a.y, w: st.ARM_ART_SIZE, h: st.ARM_ART_SIZE }
      const handle = {
        x: Math.round((W - HANDLE_W) / 2),
        y: HANDLE_Y,
        w: HANDLE_W,
        h: HANDLE_H,
      }
      const apart = pic.x >= handle.x + handle.w || handle.x >= pic.x + pic.w
      expect(apart, `${W}`).toBe(true)
      expect(pic.x + pic.w).toBeLessThanOrEqual(W - 8)
      expect(pic.y + pic.h).toBeLessThanOrEqual(st.BODY_Y)
      expect(pic.y + pic.h).toBeLessThanOrEqual(st.stationCardHeight('arm'))
    }
    expect(st.armArt(360, () => false)).toBeNull()
    // world-bound card: the frame's home is world (packed into both)
    expect(atlasOf('sorter_arm_f0')).toBe('world')
  })
})

describe('B3 §3.5 (M12): the shelf cap bonus in the shelf tooltip', () => {
  it('no bonus reads nothing; a cap +20 card reads ` (+20)` and survives a level-up', () => {
    const sim = fund(makeSim(1))
    const vs = createViewSim(sim)
    const l1 = data.levels.find((l) => l.level === 1)!.shelfCap
    expect(vs.shelf.cap).toBe(l1)
    expect(ws.shelfBonus(data, vs.level, vs.shelf.cap)).toBe(0)
    expect(ws.shelfBonusText(data, vs.level, vs.shelf.cap)).toBe('')
    applyModifier(sim, {
      key: 'shelfCap',
      mult: 1,
      add: 20,
      scope: null,
      untilTick: null,
      eventId: 'ev_test_cap',
      label: 'Test cap',
    })
    expect(vs.shelf.cap).toBe(l1 + 20)
    expect(ws.shelfBonus(data, vs.level, vs.shelf.cap)).toBe(20)
    expect(ws.shelfBonusText(data, vs.level, vs.shelf.cap)).toBe(' (+20)')
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 2 }).ok).toBe(true)
    const l2 = data.levels.find((l) => l.level === 2)!.shelfCap
    expect(vs.shelf.cap).toBe(l2 + 20)
    expect(ws.shelfBonusText(data, vs.level, vs.shelf.cap)).toBe(' (+20)')
    // A cap under the row (never expected) or an unknown level reads nothing.
    expect(ws.shelfBonus(data, 2, l2 - 5)).toBe(0)
    expect(ws.shelfBonus(data, 99, 500)).toBe(0)
  })
})
