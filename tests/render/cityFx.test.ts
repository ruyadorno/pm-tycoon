// The city's M3 flourishes (plan.md §12.6 tasks 5 + 9; city-view.md §1.4,
// §2, §9.6; spec-core.md §3.5, §9.2, Q33), pinned on the pure timelines the
// scene drives its sprites from (src/render/cityFx.ts).
import { describe, expect, it } from 'vitest'
import {
  BAY_LIGHTS,
  CONSTRUCTION_MS,
  CONSTRUCTION_SWAP_MS,
  DOCK_BLEND_TILES,
  DOCK_POSE_CANVAS,
  dockBlend,
  dustFrame,
  dustPoints,
  fadeK,
  grumbleDue,
  GRUMBLE_EVERY_MS,
  honkShown,
  levelStampText,
  moodFor,
  SIGN_POP_MS,
  signCracked,
  signDaysText,
  signPopFrame,
  SMOKE_FRAMES,
  SMOKE_PERIOD_MS,
  SMOKE_PHASE_MS,
  SMOKE_PUFFS,
  smokePuff,
  STAMP_MS,
  STAMP_RISE_MS,
  STAMP_RISE_PX,
  stampPose,
  UNLOCK_FADE_MS,
  WH_CANVAS,
} from '../../src/render/cityFx.ts'
import { buildGameData } from '../../src/data/index.ts'
import { loadRawData } from '../../tools/sim/load.node.ts'

const data = buildGameData(loadRawData())
const sat = data.economy.satisfaction
const lot = data.map.lot

describe('region unlock (§1.4): 1 s crossfade, then sign_pop 3 frames / 300 ms', () => {
  it('the fade runs 0 → 1 over exactly 1 s', () => {
    expect(UNLOCK_FADE_MS).toBe(1000)
    expect(fadeK(0, UNLOCK_FADE_MS)).toBe(0)
    expect(fadeK(500, UNLOCK_FADE_MS)).toBe(0.5)
    expect(fadeK(UNLOCK_FADE_MS, UNLOCK_FADE_MS)).toBe(1)
    expect(fadeK(Infinity, UNLOCK_FADE_MS)).toBe(1)
  })

  it('the sign pops through frames 0, 1, 2 and is gone at 300 ms', () => {
    expect(SIGN_POP_MS).toBe(300)
    expect(signPopFrame(0)).toBe(0)
    expect(signPopFrame(99)).toBe(0)
    expect(signPopFrame(100)).toBe(1)
    expect(signPopFrame(250)).toBe(2)
    expect(signPopFrame(300)).toBeNull()
  })
})

describe('level-up moment (§9.6): fx_dust 4 × 250 ms, swap on the reveal, the stamp', () => {
  it('scaffold, dust, dust, reveal at 250-ms steps, then nothing', () => {
    expect(CONSTRUCTION_MS).toBe(1000)
    expect([0, 249, 250, 500, 999].map(dustFrame)).toEqual([0, 0, 1, 2, 3])
    expect(dustFrame(1000)).toBeNull()
  })

  it('the exterior swaps to the new tier as the reveal frame starts', () => {
    expect(CONSTRUCTION_SWAP_MS).toBe(750)
    expect(dustFrame(CONSTRUCTION_SWAP_MS)).toBe(3)
  })

  it('stamp reads LEVEL 2 — LOCAL for the levels.json L2 row', () => {
    const l2 = data.levels.find((l) => l.level === 2)
    expect(l2).toBeDefined()
    expect(levelStampText(2, l2?.title ?? '')).toBe('LEVEL 2 — LOCAL')
  })

  it('the stamp rises 24 px over 1.2 s from the roof, then fades out', () => {
    expect(stampPose(0)).toEqual({ dy: 0, alpha: 1 })
    const mid = stampPose(STAMP_RISE_MS / 2)
    expect(mid?.dy).toBeLessThan(0)
    expect(mid?.dy).toBeGreaterThan(-STAMP_RISE_PX)
    expect(stampPose(STAMP_RISE_MS)).toEqual({ dy: -STAMP_RISE_PX, alpha: 1 })
    const late = stampPose(STAMP_MS - 1)
    expect(late?.dy).toBe(-STAMP_RISE_PX)
    expect(late?.alpha).toBeLessThan(0.05)
    expect(stampPose(STAMP_MS)).toBeNull()
  })

  it('dust puffs cover only the opaque part of the exterior', () => {
    const rect = { x: 0, y: 86, w: 256, h: 170 }
    const all = dustPoints(rect, () => true)
    expect(all.length).toBeGreaterThan(30)
    for (const p of all) {
      expect(p.x).toBeGreaterThanOrEqual(rect.x)
      expect(p.x).toBeLessThan(rect.x + rect.w)
      expect(p.y).toBeGreaterThanOrEqual(rect.y)
      expect(p.y).toBeLessThan(rect.y + rect.h)
    }
    const left = dustPoints(rect, (x) => x < 128)
    expect(left.length).toBeGreaterThan(0)
    expect(left.every((p) => p.x < 128)).toBe(true)
  })

  it('the dust cloud is the same every run (no Math.random)', () => {
    const rect = { x: 10, y: 86, w: 256, h: 170 }
    expect(dustPoints(rect, () => true)).toEqual(dustPoints(rect, () => true))
  })
})

describe('mood overlays (spec §9.2): flower boxes ≥ 80, shutters < 30', () => {
  it('uses economy.satisfaction thresholds', () => {
    expect(sat.happyAbove).toBe(80)
    expect(sat.loudBelow).toBe(30)
    expect(moodFor(29, sat)).toBe('unhappy')
    expect(moodFor(30, sat)).toBeNull()
    expect(moodFor(sat.start, sat)).toBeNull() // a fresh unlock shows none
    expect(moodFor(79, sat)).toBeNull()
    expect(moodFor(80, sat)).toBe('happy')
    expect(moodFor(100, sat)).toBe('happy')
  })

  it('an angry label grumbles at once, then every 20 s', () => {
    expect(GRUMBLE_EVERY_MS).toBe(20_000)
    expect(grumbleDue(null, 5)).toBe(true)
    expect(grumbleDue(5, 5 + 19_999)).toBe(false)
    expect(grumbleDue(5, 5 + 20_000)).toBe(true)
  })
})

describe('days since last incident (Q33): cracked for one day after a loss', () => {
  it('whole before any loss, cracked at 0 after one, whole again at 1', () => {
    expect(signCracked(0, false)).toBe(false)
    expect(signCracked(0, true)).toBe(true)
    expect(signCracked(1, true)).toBe(false)
    expect(signDaysText(0)).toBe('0 days')
    expect(signDaysText(1)).toBe('1 day')
    expect(signDaysText(12)).toBe('12 days')
  })
})

describe('honking queue (§2): ic_honk 500 ms every 4 s, phase id mod 4', () => {
  it('shows 500 ms of every 4 s', () => {
    let shown = 0
    for (let t = 0; t < 4000; t += 10) if (honkShown(t, 0)) shown += 10
    expect(shown).toBe(500)
  })

  it('vehicles 1 s apart in id mod 4 honk in turn', () => {
    expect(honkShown(0, 0)).toBe(true)
    expect(honkShown(0, 1)).toBe(false)
    expect(honkShown(3000, 1)).toBe(true)
    expect(honkShown(0, 4)).toBe(true)
  })
})

describe('warehouse exterior hand-off: bay lights and the docked pose', () => {
  it('lights sit on the bay lamps of the 256-px exterior canvas', () => {
    expect(BAY_LIGHTS).toEqual([
      [47, 139],
      [71, 151],
      [96, 163],
    ])
    for (const [x, y] of BAY_LIGHTS) {
      expect(x).toBeLessThan(WH_CANVAS / 2) // the visible SW face
      expect(y).toBeLessThan(WH_CANVAS)
    }
    expect(DOCK_POSE_CANVAS).toEqual([40, 178])
  })

  const dock = lot.docks[0] as [number, number]
  const lotX0 = lot.entrance[0] + 1

  it('a vehicle on the dock tile is drawn fully at the pose', () => {
    expect(dockBlend(dock[0], dock[1], dock, lotX0)).toBe(1)
  })

  it('the queue head and the avenue are untouched; the approach blends', () => {
    const head = lot.queue[0] as [number, number]
    expect(Math.hypot(head[0] - dock[0], head[1] - dock[1])).toBe(
      DOCK_BLEND_TILES,
    )
    expect(dockBlend(head[0], head[1], dock, lotX0)).toBe(0)
    // The entrance is on the avenue column: no offset for through-traffic.
    expect(dockBlend(lot.entrance[0], lot.entrance[1], dock, lotX0)).toBe(0)
    const mid = dockBlend(dock[0], dock[1] + 1.5, dock, lotX0)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })

  it('the parking row behind the sprite is never moved', () => {
    for (const [x, y] of lot.parking)
      expect(dockBlend(x, y, dock, lotX0)).toBe(0)
  })

  it('blends continuously along the drive from the queue head onto the dock', () => {
    let prev = 0
    for (let ty = dock[1] + DOCK_BLEND_TILES; ty >= dock[1]; ty -= 0.05) {
      const w = dockBlend(dock[0], ty, dock, lotX0)
      expect(Math.abs(w - prev)).toBeLessThan(0.03)
      expect(w).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = w
    }
  })
})

describe('Industrial smoke (§1.3): fx_smoke_f0..3 at 4 fps, 3 puffs, phase offset', () => {
  it('a puff steps one frame per 250 ms and rises', () => {
    expect(SMOKE_PERIOD_MS).toBe(1000)
    const frames = [0, 250, 500, 750].map((t) => smokePuff(t, 0, 0).frame)
    expect(frames).toEqual([0, 1, 2, 3])
    expect(smokePuff(900, 0, 0).dy).toBeLessThan(smokePuff(100, 0, 0).dy)
  })

  it('the 3 puffs of an emitter are a third of a cycle apart', () => {
    expect(SMOKE_PUFFS).toBe(3)
    const seen = new Set([0, 1, 2].map((k) => smokePuff(0, 0, k).frame))
    expect(seen.size).toBe(SMOKE_PUFFS)
    for (let k = 0; k < SMOKE_PUFFS; k++) {
      const p = smokePuff(123, 0, k)
      expect(p.frame).toBeGreaterThanOrEqual(0)
      expect(p.frame).toBeLessThan(SMOKE_FRAMES)
    }
  })

  it('neighbouring emitters are out of phase', () => {
    const a = smokePuff(0, 0, 0)
    const b = smokePuff(0, SMOKE_PHASE_MS, 0)
    expect(a.dy).not.toBe(b.dy)
  })

  it('the six emitters come from the five Industrial smoke anchors', async () => {
    const { SMOKE_ANCHORS } =
      await import('../../src/render/frames.generated.ts')
    const n = Object.values(SMOKE_ANCHORS).reduce((s, a) => s + a.length, 0)
    expect(n).toBe(6)
    for (const id of Object.keys(SMOKE_ANCHORS)) {
      const b = data.buildings.find((x) => x.id === id)
      expect(b?.district).toBe('industrial')
    }
  })
})
