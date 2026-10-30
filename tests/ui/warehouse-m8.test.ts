// Warehouse M8 (plan-build2 §8.5 tasks 3, 4, 6; design-m8-m9 §6.1, §6.4,
// R7, R8, R13; spec-build2 §4.1): docks 2–3 in the room — the bay look per
// DockSlotView (locked `Lv3`, buyable `+ $800`, owned with its roller pad),
// the buy dialog text, the status panel's lines / lamps / bars with one to
// three docks, the per-dock tooltips — and the tier-3 room: visualTier
// 1..5, the frame fallback to the nearest lower tier, the tier parts, the
// tier-3 frames and their atlases, the parcel pool. Pure helpers + a
// headless Sim through the ViewSim facade; Phaser is stubbed.
import { readFileSync } from 'node:fs'
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

const dv = await import('../../src/render/warehouse/DockView.ts')
const lr = await import('../../src/render/warehouse/LaneRenderer.ts')
const rl = await import('../../src/render/warehouse/RoomLayout.ts')
const { DIALOG_PAD, DIALOG_W } = await import('../../src/ui/Dialog.ts')
const { FRAME_ATLAS, FRAMES, SHARED_FRAMES } =
  await import('../../src/render/frames.generated.ts')
const { collect, dataFixture, fund, makeSim } =
  await import('../sim/helpers.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')

const data = dataFixture()

/** m5x7 advance widths (the panel / dialog text widths). */
const ADVANCE = new Map<number, number>()
for (const m of readFileSync(
  new URL('../../src/assets/m5x7.xml', import.meta.url),
  'utf8',
).matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
  ADVANCE.set(Number(m[1]), Number(m[2]))
const textW = (s: string): number =>
  [...s].reduce((w, c) => w + (ADVANCE.get(c.codePointAt(0) ?? 0) ?? 0), 0)

const van = (state: string) => ({ name: 'Van 2', state }) as never

/** A dock 2 slot (DockSlotView fields the bay look reads). */
const slot = (o: Partial<Parameters<typeof dv.dockBayLook>[0]>) => ({
  index: 2 as const,
  owned: false,
  available: false,
  unlockLevel: 3,
  price: 800,
  ...o,
})

/** One owned dock as the panel reads it. */
const dock = (index: number, state: string | null, done = 0, total = 0) => ({
  index,
  v: state ? van(state) : null,
  unloaded: done,
  total,
})

describe('design-m8-m9 §6.1: dock texts', () => {
  it('a dock not owned tooltips its level and price; " · coming soon" only past the cap', () => {
    expect(dv.lockedDockText(data, 2)).toBe(
      'Loading dock 2 — unlocks at Lv 3 ($800)',
    )
    // M9: the shipped cap is the top level (5), so no dock is "coming soon".
    expect(data.economy.playtestMaxLevel).toBe(5)
    expect(dv.lockedDockText(data, 3)).toBe(
      'Loading dock 3 — unlocks at Lv 4 ($1,000)',
    )
    const capped = dataFixture({ economy: { playtestMaxLevel: 2 } })
    expect(dv.lockedDockText(capped, 2)).toBe(
      'Loading dock 2 — unlocks at Lv 3 ($800) · coming soon',
    )
    const cap3 = dataFixture({ economy: { playtestMaxLevel: 3 } })
    expect(dv.lockedDockText(cap3, 3)).toBe(
      'Loading dock 3 — unlocks at Lv 4 ($1,000) · coming soon',
    )
    expect(dv.lockedDockText(data, 1)).toBeNull()
    expect(dv.lockedDockText(data, 4)).toBeNull()
  })

  it('the buy dialog: `Loading dock 2` · `$800 · a second door into slot 1` · `Buy $800` (one line in the 280-px dialog); the ordinal counts doors, not dock numbers', () => {
    const d2 = dv.dockBuyDialog({ index: 2, price: 800 }, 1)
    expect(d2).toEqual({
      title: 'Loading dock 2',
      text: '$800 · a second door into slot 1',
      action: 'Buy $800',
    })
    const d3 = dv.dockBuyDialog({ index: 3, price: 2000 }, 2)
    expect(d3).toEqual({
      title: 'Loading dock 3',
      text: '$2,000 · a third door into slot 1',
      action: 'Buy $2,000',
    })
    // Dock 3 before dock 2 (L4, design-m8-m9 §4.9): the second door.
    expect(dv.dockBuyDialog({ index: 3, price: 2000 }, 1).text).toBe(
      '$2,000 · a second door into slot 1',
    )
    for (const d of [d2, d3])
      expect(textW(d.text)).toBeLessThanOrEqual(DIALOG_W - 2 * DIALOG_PAD)
  })

  it('dockActivity keeps the playtest-1 wording', () => {
    expect(dv.dockActivity(van('docked_unloading'), 4, 9)).toBe(
      'Van 2 unloading 4/9',
    )
    expect(dv.dockActivity(van('docked_loading'), 0, 0)).toBe('Van 2 loading')
    expect(dv.dockActivity(null, 0, 0)).toBe('Empty')
  })
})

describe('design-m8-m9 §6.1: the bay look per dock slot', () => {
  it('below its level: the locked door with the lock and `Lv3`, no pad, no lamp', () => {
    expect(dv.dockBayLook(slot({}), false)).toEqual({
      door: 'dock_door_locked',
      pad: false,
      lamp: false,
      badge: 'lock',
      badgeText: 'Lv3',
    })
  })

  it('at its level, not bought: still the locked door, a "+" and the price (tap → buy dialog)', () => {
    expect(dv.dockBayLook(slot({ available: true }), false)).toEqual({
      door: 'dock_door_locked',
      pad: false,
      lamp: false,
      badge: 'buy',
      badgeText: '$800',
    })
    // The price fits the 32-px door; $2,000's extra pixel spills east, never
    // past the west wall (M8 review: x was −1).
    expect(textW('$800')).toBeLessThanOrEqual(32)
    expect(textW('$2,000')).toBeLessThanOrEqual(34)
    const door3 = rl.dockGeom(3)!.door
    expect(dv.badgeTextX(door3, textW('$2,000'))).toBeGreaterThanOrEqual(0)
    expect(dv.badgeTextX(door3, textW('$800'))).toBe(
      Math.round(door3.x + (door3.w - textW('$800')) / 2),
    )
    expect(dv.badgeTextX({ x: 0, w: 32 }, 33)).toBe(0)
  })

  it('M9: a buyable door\'s price sits on a ui_badge tag (dark on light — the tier-4/5 walls are light), inside the room, below the "+", every shipped price fitting it', () => {
    expect(FRAME_ATLAS['ui_badge']).toBeDefined()
    for (const k of [2, 3]) {
      const door = rl.dockGeom(k)!.door
      const r = dv.priceTagRect(door)
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect([r.w, r.h]).toEqual([dv.PRICE_TAG.w, dv.PRICE_TAG.h])
      // Below the "+" (centred at door.y + 20, 16 px), inside the door's height.
      expect(r.y).toBeGreaterThanOrEqual(door.y + 28)
      expect(r.y + r.h).toBeLessThanOrEqual(door.y + door.h)
    }
    for (const d of data.economy.docks.filter((x) => x.price > 0)) {
      const w = textW(`$${d.price.toLocaleString('en-US')}`)
      expect(w, `dock ${d.index}`).toBeLessThanOrEqual(dv.PRICE_TAG.w - 4)
    }
  })

  it('owned: closed (open while a vehicle stands in it), its pad and lamp; dock 1 has no pad', () => {
    const owned = slot({ owned: true, available: true })
    expect(dv.dockBayLook(owned, false)).toEqual({
      door: 'dock_door_closed',
      pad: true,
      lamp: true,
      badge: null,
      badgeText: null,
    })
    expect(dv.dockBayLook(owned, true).door).toBe('dock_door_open')
    const d1 = { index: 1 as const, owned: true, available: true }
    expect(dv.dockBayLook({ ...d1, unlockLevel: 1, price: 0 }, false).pad).toBe(
      false,
    )
  })
})

describe('design-m8-m9 §6.1: the dock panel with one to three docks', () => {
  it('one dock: `Dock 1` + its activity without the vehicle name (playtest 1)', () => {
    expect(dv.dockPanelLine([dock(1, 'docked_unloading', 4, 9)])).toEqual({
      title: 'Dock 1',
      status: 'unloading 4/9',
    })
    expect(dv.dockPanelLine([dock(1, null)])).toEqual({
      title: 'Dock 1',
      status: 'Empty',
    })
    expect(dv.dockPanelTooltip([dock(1, 'docked_unloading', 4, 9)], 1)).toBe(
      'Dock 1 — Van 2 unloading 4/9 · queue 1',
    )
  })

  it('more docks: `2 docks` + `1 unloading` (else loading, else Empty); the panel tap reads `2 docks · 1 unloading · queue 1`', () => {
    const two = [dock(1, 'docked_unloading', 1, 4), dock(2, 'docked_loading')]
    expect(dv.dockPanelLine(two)).toEqual({
      title: '2 docks',
      status: '1 unloading',
    })
    expect(dv.dockPanelTooltip(two, 1)).toBe('2 docks · 1 unloading · queue 1')
    expect(
      dv.dockPanelLine([dock(1, 'docked_loading'), dock(3, null)]).status,
    ).toBe('1 loading')
    expect(dv.dockPanelLine([dock(1, null), dock(3, null)]).status).toBe(
      'Empty',
    )
    const three = [1, 2, 3].map((k) => dock(k, 'docked_unloading', 1, 2))
    expect(dv.dockPanelLine(three)).toEqual({
      title: '3 docks',
      status: '3 unloading',
    })
  })

  it('every first line fits the 156-px panel after the lamp column (title at +18, status at +62 or after the title)', () => {
    const P = rl.DOCK_PANEL
    const lines: { title: string; status: string }[] = [
      { title: 'Dock 1', status: 'unloading 12/12' },
      { title: 'Dock 1', status: 'loading' },
      { title: '3 docks', status: '3 unloading' },
      { title: '2 docks', status: '2 loading' },
    ]
    for (const l of lines) {
      const sx = Math.max(
        dv.PANEL_STATUS_X,
        dv.PANEL_TITLE_X + textW(l.title) + 6,
      )
      expect(
        sx + textW(l.status),
        `${l.title} ${l.status}`,
      ).toBeLessThanOrEqual(P.w - 6)
    }
    // The queue line clears the vehicle glyphs at +70.
    expect(dv.PANEL_TITLE_X + textW('Queue 10')).toBeLessThanOrEqual(70)
  })

  it('lamps: one dock = the playtest-1 rule (red while queued or blocked); more docks blink red only on a busy dock', () => {
    // one dock
    expect(dv.dockLamp(false, false, 1, 1, true)).toBe('lamp_red')
    expect(dv.dockLamp(false, false, 1, 1, false)).toBe('lamp_off')
    expect(dv.dockLamp(false, true, 0, 1, true)).toBe('lamp_green')
    expect(dv.dockLamp(true, true, 0, 1, true)).toBe('lamp_red')
    expect(dv.dockLamp(false, false, 0, 1, true)).toBe('lamp_off')
    // two docks: an idle dock stays dark while the other one has a queue
    expect(dv.dockLamp(false, false, 1, 2, true)).toBe('lamp_off')
    expect(dv.dockLamp(false, true, 1, 2, true)).toBe('lamp_red')
    expect(dv.dockLamp(false, true, 0, 2, true)).toBe('lamp_green')
    expect(dv.dockLamp(true, true, 0, 3, true)).toBe('lamp_red')
  })

  it('one unload bar per owned dock, side by side inside the panel', () => {
    const inner = rl.DOCK_PANEL.w - 12
    expect(dv.dockBarSegments(inner, 1)).toEqual([{ x: 0, w: inner }])
    for (const n of [2, 3]) {
      const segs = dv.dockBarSegments(inner, n)
      expect(segs).toHaveLength(n)
      for (let i = 1; i < segs.length; i++) {
        const a = segs[i - 1] as { x: number; w: number }
        const b = segs[i] as { x: number; w: number }
        expect(b.x).toBeGreaterThanOrEqual(a.x + a.w + 1)
        expect(b.w).toBe(a.w)
      }
      const last = segs[segs.length - 1] as { x: number; w: number }
      expect(last.x + last.w).toBeLessThanOrEqual(inner)
      expect(last.w).toBeGreaterThan(30)
    }
  })

  it('the panel lamp column (8 × 8, top = dock 1) sits left of the text, above the bars, inside the panel', () => {
    const lamps = [1, 2, 3].map((k) => ({
      x: dv.PANEL_LAMP_X,
      y: dv.PANEL_LAMP_Y + dv.PANEL_LAMP_PITCH * (k - 1),
      w: 8,
      h: 8,
    }))
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i] as { x: number; y: number; w: number; h: number }
      expect(l.x + l.w).toBeLessThan(dv.PANEL_TITLE_X)
      expect(l.y).toBeGreaterThanOrEqual(0)
      // the unload bars run at PANEL_H − 5
      expect(l.y + l.h).toBeLessThanOrEqual(dv.PANEL_H - 5)
      if (i > 0)
        expect(l.y).toBeGreaterThanOrEqual(
          (lamps[i - 1]?.y ?? 0) + (lamps[i - 1]?.h ?? 0),
        )
    }
  })
})

describe('design-m8-m9 §3.3 / §6.1: the docks through the ViewSim facade', () => {
  it('L1: docks 2–3 are locked bays (`Lv3` / `Lv4`); L3: dock 2 buyable, then owned with its pad after buyDock; dock 3 stays locked', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    const look = (k: number) => {
      const s = vs.lane.dockSlots().find((x) => x.index === k)
      if (!s) throw new Error(`dock ${k}`)
      return dv.dockBayLook(s, false)
    }
    expect(vs.lane.dockSlots().map((s) => s.index)).toEqual([1, 2, 3])
    expect(look(1)).toMatchObject({ door: 'dock_door_closed', pad: false })
    expect(look(2)).toMatchObject({ badge: 'lock', badgeText: 'Lv3' })
    expect(look(3)).toMatchObject({ badge: 'lock', badgeText: 'Lv4' })
    expect(vs.lane.buyDock(2)).toEqual({ ok: false, reason: 'locked' })

    expect(sim.dispatch({ kind: 'debugForceLevel', level: 3 })).toEqual({
      ok: true,
    })
    expect(look(2)).toMatchObject({ badge: 'buy', badgeText: '$800' })
    fund(sim, 10_000)
    const bought = collect(sim, 'dock:bought')
    expect(vs.lane.buyDock(2)).toEqual({ ok: true })
    expect(bought).toEqual([{ index: 2, dockId: 'dock2' }])
    expect(look(2)).toEqual({
      door: 'dock_door_closed',
      pad: true,
      lamp: true,
      badge: null,
      badgeText: null,
    })
    expect(look(3)).toMatchObject({ badge: 'lock', badgeText: 'Lv4' })
    // The room's layout places the bought nodes (pads draw minis there).
    const lay = new rl.FixedLaneLayout(lr.visualTier(data, vs.level))
    expect(lay.tier).toBe(3)
    for (const id of ['dock2', 'conv2']) expect(lay.has(id)).toBe(true)
    expect(lay.isPad('conv2')).toBe(true)
    expect(vs.docks.map((d) => d.id)).toEqual(['dock1', 'dock2'])
  })

  it('R8: dock 3 bought first (forceLevel 4) owns bay 3 while bay 2 stays buyable', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    sim.dispatch({ kind: 'debugForceLevel', level: 4 })
    fund(sim, 10_000)
    expect(vs.lane.buyDock(3)).toEqual({ ok: true })
    const slots = vs.lane.dockSlots()
    expect(dv.dockBayLook(slots[2] as never, false).pad).toBe(true)
    expect(dv.dockBayLook(slots[1] as never, false).badge).toBe('buy')
    expect(vs.docks.map((d) => d.id)).toEqual(['dock1', 'dock3'])
  })
})

/** A fake atlas for the fallback rule. */
const has = (n: string) => ['wall_t1', 'wall_t3', 'sign_t2'].includes(n)

describe('spec-build2 §4.1: Hold Bay bays 4–5 light at L3 (cap-driven)', () => {
  it('the L3 row raises the cap to 5 and is the level the room tags on bays 4–5', () => {
    const sim = makeSim(1)
    const vs = createViewSim(sim)
    expect(vs.holdBay.cap).toBe(3)
    // LaneRenderer.bayUnlockLevel / syncBays: the first row whose cap opens bay i.
    const tag = (i: number) => data.levels.find((l) => l.holdBayCap > i)?.level
    expect([tag(3), tag(4)]).toEqual([3, 3])
    expect(3).toBeLessThanOrEqual(data.economy.playtestMaxLevel)
    sim.dispatch({ kind: 'debugForceLevel', level: 3 })
    expect(vs.holdBay.cap).toBe(rl.BAY_COUNT)
    expect(vs.shelf.cap).toBe(60)
  })
})

describe('design-m8-m9 §6.1: tier 3 and the frame fallback', () => {
  it('tierFrame resolves `<stem>_t<t>` or the nearest lower tier, else null', () => {
    expect(lr.tierFrame('wall', 5, has)).toBe('wall_t3')
    expect(lr.tierFrame('wall', 3, has)).toBe('wall_t3')
    expect(lr.tierFrame('wall', 2, has)).toBe('wall_t1')
    expect(lr.tierFrame('sign', 1, has)).toBeNull()
    expect(lr.tierFrame('sign', 4, has)).toBe('sign_t2')
    expect(
      lr.tierFrame('floor', 3, (n) => n === 'floor_t2_lane', '_lane'),
    ).toBe('floor_t2_lane')
    // The real atlas (M9 art packed): every tier draws its own room; a
    // tier past the art (6) falls back to the top one.
    for (const stem of ['wall', 'wallface', 'sign', 'shelf', 'wanted_poster'])
      for (const t of [3, 4, 5])
        expect(lr.tierFrame(stem, t), `${stem} t${t}`).toBe(`${stem}_t${t}`)
    expect(lr.tierFrame('props', 5)).toBe('props_t5')
    expect(lr.tierFrame('props', 6)).toBe('props_t5')
  })

  it('floors: tier-1 crack variants, `floor_t<t>` and its `_lane` in the belt column above', () => {
    expect(lr.floorFrameFor(1, 2, 3)).toMatch(/^floor_t1_[012]$/)
    expect(lr.floorFrameFor(2, 4, 3)).toBe('floor_t2_lane')
    expect(lr.floorFrameFor(2, 3, 3)).toBe('floor_t2')
    expect(lr.floorFrameFor(3, 4, 3)).toBe('floor_t3_lane')
    expect(lr.floorFrameFor(3, 5, 7)).toBe('floor_t3')
    expect(lr.floorFrameFor(5, 5, 7)).toBe('floor_t5')
    expect(lr.floorFrameFor(4, 4, 7)).toBe('floor_t4_lane')
    // Tier 5 art missing: the nearest lower tier's floor.
    expect(lr.floorFrameFor(5, 5, 7, (n) => n === 'floor_t3')).toBe('floor_t3')
    // No art at all above tier 1: the crack variants, never a missing frame.
    expect(lr.floorFrameFor(3, 4, 3, () => false)).toMatch(/^floor_t1_/)
  })

  it('tier parts: the bulb at t1, strip lights and plates from t2, props by group, dark sign text from t2', () => {
    expect(lr.tierParts(1)).toEqual({
      bulb: true,
      strips: false,
      plates: false,
      props: 1,
      signDark: false,
      neon: false,
    })
    expect(lr.tierParts(2)).toMatchObject({
      bulb: false,
      strips: true,
      props: 2,
    })
    for (const t of [3, 4, 5])
      expect(lr.tierParts(t)).toEqual({
        bulb: false,
        strips: true,
        plates: true,
        props: 3,
        signDark: true,
        // M9: the tier-5 strip-light spots carry the neon tubes.
        neon: t === 5,
      })
  })

  it('L3 is tier 3 (levels.json) and every tier-3 frame the room asks for is packed, in the atlas its layer binds', () => {
    expect(lr.visualTier(data, 3)).toBe(3)
    const frames = FRAMES as Record<string, string>
    const back = [
      'floor_t3',
      'floor_t3_lane',
      'wall_t3',
      'wallface_t3',
      'sign_t3',
      'shelf_t3',
      'wanted_poster_t3',
      'props_t3',
      'dock_pad',
      'dock_door_locked',
    ]
    for (const f of back) {
      expect(frames[f], f).toBeDefined()
      // back layers bind `interior` (roomAtlas)
      expect(
        (FRAME_ATLAS as Record<string, string>)[f] === 'interior' ||
          SHARED_FRAMES.has(f),
        f,
      ).toBe(true)
    }
    // The dock panel / wall lamps are badges (front, world).
    for (const f of ['lamp_lock', 'lamp_green', 'lamp_red', 'ic_plus'])
      expect((FRAME_ATLAS as Record<string, string>)[f], f).toBe('world')
    // The Battery checker: a machine drawn in the room (front) and in the
    // BuySheet (src/ui/**, world-only) — packed into both.
    for (const f of ['battery_checker_f0', 'battery_checker_f1'])
      expect(SHARED_FRAMES.has(f), f).toBe(true)
  })

  it('the parcel pool covers three conveyors, six slots, the Hold Bay and a margin', () => {
    const conv = data.machines.conveyorCapPerDock * rl.DOCK_COUNT
    const slots = 6 * (data.machines.slotBufferCap + 3)
    expect(lr.MAX_PARCELS).toBe(72)
    expect(lr.MAX_PARCELS).toBeGreaterThan(conv + slots + rl.BAY_COUNT)
  })
})
