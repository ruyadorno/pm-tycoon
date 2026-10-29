// Smoke test (plan.md §6.9.3 first bullet), grown one assertion group per
// milestone:
//   M0 (§12.3 task 15) — the gallery variant: the build boots under
//      SwiftShader, __pm.ready flips, no console errors, the m5x7 BitmapFont is
//      registered from the atlas (and has ink), the GPU limits the ground bake
//      needs are logged/asserted, and the gallery pages are captured for
//      review: shots/m0-gallery.png (page 2, every atlas frame),
//      shots/m0-map.png (page 3, the 48x48 map), plus m0-palette / m0-hud.
//   M1 (§12.4) — the city loop: /?seed=7&debug=1&skipTitle=1&audio=0&policy=1
//      boots City + HUD with the same GPU/font/scale checks, the policy's
//      first parcel:delivered (waitEvent) shows in metrics(), a frame with
//      HUD + city + popups stays ≤ 8 draw calls (one atlas, §6.11), the HUD
//      Warehouse button switches to the (stub) Warehouse and back, the
//      autosave key appears, every live HUD hit rect is ≥ 44/zoom with no
//      overlaps in the bottom bar, and the chips row fits W − 12 at W = 360
//      at L1 and L2.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

const BASE = '/?view=gallery&debug=1&seed=1&audio=0'
const M1_URL = '/?seed=7&debug=1&skipTitle=1&audio=0&policy=1'
/** plan.md §6.11: draw calls per frame with HUD + city + popups. */
const MAX_DRAW_CALLS = 8
/** src/boot/autosave.ts SAVE_KEY. */
const SAVE_KEY = 'pm.save.v1'

interface BootInfo {
  font: boolean
  /** Opaque pixels of the atlas's m5x7 frame (an empty sheet registers fine but draws nothing). */
  fontPixels: number
  maxTexture: number
  derivatives: boolean
  zoom: number
  displayScale: { x: number; y: number }
  size: { w: number; h: number }
  scenes: string[]
}

function bootInfo(page: Page): Promise<BootInfo> {
  return page.evaluate((): BootInfo => {
    const game = window.__pm!.game
    const r = game.renderer as unknown as {
      getMaxTextureSize(): number
      standardDerivativesExtension: unknown
    }
    const tex = game.textures.get('world')
    let fontPixels = 0
    if (tex.has('m5x7')) {
      const fr = tex.get('m5x7')
      const c = document.createElement('canvas')
      c.width = fr.cutWidth
      c.height = fr.cutHeight
      const ctx = c.getContext('2d')!
      ctx.drawImage(
        tex.getSourceImage() as CanvasImageSource,
        fr.cutX,
        fr.cutY,
        fr.cutWidth,
        fr.cutHeight,
        0,
        0,
        fr.cutWidth,
        fr.cutHeight,
      )
      const px = ctx.getImageData(0, 0, c.width, c.height).data
      for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) fontPixels++
    }
    return {
      font: game.cache.bitmapFont.has('m5x7'),
      fontPixels,
      maxTexture: r.getMaxTextureSize(),
      derivatives: r.standardDerivativesExtension != null,
      zoom: game.scale.zoom,
      displayScale: {
        x: game.scale.displayScale.x,
        y: game.scale.displayScale.y,
      },
      size: { w: game.scale.width, h: game.scale.height },
      scenes: game.scene.getScenes(true).map((s) => s.sys.settings.key),
    }
  })
}

function expectBoot(info: BootInfo): void {
  console.log(
    `smoke: maxTextureSize=${info.maxTexture} standardDerivatives=${info.derivatives} ` +
      `zoom=${info.zoom} logical=${info.size.w}x${info.size.h} fontPixels=${info.fontPixels} ` +
      `scenes=${info.scenes.join(',')}`,
  )
  expect(info.font, 'cache.bitmapFont.has("m5x7")').toBe(true)
  // Soft: an empty sheet still fails the test, but the shots get written.
  expect
    .soft(info.fontPixels, 'the m5x7 glyph sheet has ink')
    .toBeGreaterThan(200)
  expect(info.maxTexture).toBeGreaterThanOrEqual(4096)
  expect(info.derivatives, 'standardDerivativesExtension').toBe(true)
  expect(info.displayScale.x).toBeCloseTo(1 / info.zoom, 6)
  expect(info.displayScale.y).toBeCloseTo(1 / info.zoom, 6)
}

test.describe('M0 gallery smoke', () => {
  test('boots, registers m5x7, renders pages 1-4 without console errors', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(`${BASE}&page=2`)
    const info = await bootInfo(page)
    expect(info.scenes[0]).toBe('Gallery')
    expectBoot(info)

    const frames = await page.evaluate(() => {
      const g = window.__pm!.game.scene.getScene('Gallery') as unknown as {
        frameCount: number
      }
      return g.frameCount
    })
    console.log(`smoke: gallery page 2 shows ${frames} atlas frames`)
    expect(frames).toBeGreaterThan(100)
    await pm.shot('m0-gallery')

    await pm.open(`${BASE}&page=3`)
    const map = await page.evaluate(() => {
      const api = window.__pm!
      const g = api.game.scene.getScene('Gallery') as unknown as {
        mapStats: {
          buildings: number
          props: number
          signs: number
          missing: string[]
        } | null
      }
      return {
        stats: g.mapStats,
        rows: api.data.buildings.length,
        props: api.data.map.props.length,
        groundTexture: api.game.textures.exists('ground'),
      }
    })
    console.log(`smoke: map ${JSON.stringify(map)}`)
    expect(map.groundTexture).toBe(true)
    expect(map.stats?.buildings).toBe(map.rows)
    expect(map.stats?.props).toBe(map.props)
    expect(map.stats?.signs).toBeGreaterThan(0)
    await pm.shot('m0-map')

    await pm.open(`${BASE}&page=1`)
    await pm.shot('m0-palette')
    await pm.open(`${BASE}&page=4`)
    await pm.shot('m0-hud')

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

// ---- M1 ------------------------------------------------------------------

interface HudTarget {
  /** Button / tap-zone id (data 'id' on the object or its Button container); '' for tap-swallowing backgrounds. */
  id: string
  x: number
  y: number
  w: number
  h: number
}

interface HudHits {
  W: number
  zoom: number
  minHit: number
  bottomBar: { x: number; y: number; w: number; h: number }
  targets: HudTarget[]
}

/**
 * Every live input candidate of the HUD scene with its hit rect in screen px
 * (the HUD camera never scrolls or zooms). Phaser only hit-tests enabled
 * objects whose own and parent containers' `visible` are set; dead entries
 * (input null, the same-frame create + destroy quirk) are skipped.
 */
function hudHits(page: Page): Promise<HudHits> {
  return page.evaluate((): HudHits => {
    type Obj = {
      input: {
        enabled: boolean
        hitArea: { x: number; y: number; width: number; height: number }
      } | null
      active: boolean
      visible: boolean
      x: number
      y: number
      displayOriginX?: number
      displayOriginY?: number
      parentContainer: Obj | null
      getData?(k: string): unknown
    }
    const game = window.__pm!.game
    const hud = game.scene.getScene('HUD') as unknown as {
      input: Record<string, Obj[]>
      L: {
        W: number
        zoom: number
        minHit: number
        bottomBar: { x: number; y: number; w: number; h: number }
      }
    }
    const targets: HudTarget[] = []
    // InputPlugin's private list of interactive objects.
    for (const o of hud.input['_list'] ?? []) {
      if (!o.input || !o.input.enabled || !o.active || !o.input.hitArea)
        continue
      let vis = o.visible
      let x = o.x - (o.displayOriginX ?? 0)
      let y = o.y - (o.displayOriginY ?? 0)
      let id = (o.getData?.('id') as string | undefined) ?? ''
      for (let p = o.parentContainer; p; p = p.parentContainer) {
        vis = vis && p.visible
        x += p.x
        y += p.y
        if (!id) id = (p.getData?.('id') as string | undefined) ?? ''
      }
      if (!vis) continue
      const h = o.input.hitArea
      targets.push({ id, x: x + h.x, y: y + h.y, w: h.width, h: h.height })
    }
    const L = hud.L
    return {
      W: L.W,
      zoom: L.zoom,
      minHit: L.minHit,
      bottomBar: L.bottomBar,
      targets,
    }
  })
}

function expectHudHits(hits: HudHits, label: string): void {
  const min = Math.ceil(44 / hits.zoom)
  expect(hits.minHit).toBe(min)
  const small = hits.targets.filter((t) => t.w < min || t.h < min)
  expect(small, `${label}: HUD hit rects under ${min} px`).toEqual([])
  const bb = hits.bottomBar
  const inBar = hits.targets.filter(
    (t) => t.id !== '' && t.y + t.h > bb.y && t.y < bb.y + bb.h,
  )
  const ids = inBar.map((t) => t.id)
  for (const id of ['speed:0', 'speed:1', 'speed:2', 'mute', 'warehouse'])
    expect(ids, `${label}: bottom-bar target ${id}`).toContain(id)
  expect(ids, `${label}: bottom-bar target garage`).toContain('garage')
  const overlaps: string[] = []
  for (let i = 0; i < inBar.length; i++) {
    for (let j = i + 1; j < inBar.length; j++) {
      const a = inBar[i]!
      const b = inBar[j]!
      if (
        a.x < b.x + b.w &&
        b.x < a.x + a.w &&
        a.y < b.y + b.h &&
        b.y < a.y + a.h
      )
        overlaps.push(`${a.id} × ${b.id}`)
    }
  }
  expect(overlaps, `${label}: overlapping bottom-bar hit rects`).toEqual([])
  console.log(
    `smoke: ${label} ${hits.targets.length} live HUD hit rects ≥ ${min} px; bottom bar: ${ids.join(' ')}`,
  )
}

interface ChipRow {
  W: number
  rowW: number
  maxRowW: number
  chips: string[]
}

function chipRow(page: Page): Promise<ChipRow> {
  return page.evaluate((): ChipRow => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      chipRowW: number
      L: { W: number; chip: { maxRowW: number } }
      chips: { entry: { id: string; lockLevel: number | null } }[]
    }
    return {
      W: hud.L.W,
      rowW: hud.chipRowW,
      maxRowW: hud.L.chip.maxRowW,
      chips: hud.chips.map(
        (c) =>
          c.entry.id +
          (c.entry.lockLevel === null ? '' : `🔒${c.entry.lockLevel}`),
      ),
    }
  })
}

/**
 * Chip tap zones in the HUD's live input list (a rebuilt row's new zones
 * join it on the next frame's input update).
 */
async function liveChipZones(page: Page): Promise<number> {
  const hits = await hudHits(page)
  return hits.targets.filter((t) => t.id.startsWith('chip:')).length
}

/** The world scenes' state as the scene manager reports it. */
function worlds(page: Page): Promise<{ city: string; warehouse: string }> {
  return page.evaluate(() => {
    const sm = window.__pm!.game.scene
    const state = (k: string): string =>
      sm.isSleeping(k) ? 'sleeping' : sm.isActive(k) ? 'active' : 'off'
    return { city: state('City'), warehouse: state('Warehouse') }
  })
}

test.describe('M1 city smoke', () => {
  test('city loop: first delivery, draw calls, warehouse round trip, autosave, HUD hit rects, chips at 360', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(M1_URL)
    const info = await bootInfo(page)
    expect(info.scenes).toContain('City')
    expect(info.scenes).toContain('HUD')
    expectBoot(info)

    // The policy's first delivery (spec §7.1: ~47 s; waitEvent caps at 60 s).
    const wait = await page.evaluate(() =>
      window.__pm!.waitEvent('parcel:delivered'),
    )
    console.log(`smoke: first parcel:delivered ${JSON.stringify(wait)}`)
    expect(wait.ok, 'parcel:delivered within 60 s of sim time').toBe(true)
    const m = await page.evaluate(() => window.__pm!.metrics())
    expect(m.deliveries).toBeGreaterThanOrEqual(1)
    expect(m.lifetimeEarned).toBeGreaterThan(0)

    // Draw calls with HUD + city + popups: follow the first bike and render
    // a frame per sim tick until a pickup / delivery popup is alive.
    const dc = await page.evaluate(() => {
      const api = window.__pm!
      const game = api.game
      api.freeze()
      api.overlay(false)
      api.settle(2)
      const base = api.metrics().drawCalls
      const city = game.scene.getScene('City') as unknown as {
        popups: { alive: number }
      }
      const v = api.sim.vehicles[0]
      if (v) game.events.emit('pm:follow', { vehicleId: v.id })
      let frames = 0
      while (city.popups.alive === 0 && frames < 1500) {
        api.advance(100)
        api.step(16)
        frames++
      }
      api.step(16)
      const out = {
        base,
        popups: city.popups.alive,
        withPopups: api.metrics().drawCalls,
        frames,
        sprites: api.metrics().sprites,
      }
      game.events.emit('pm:follow', { vehicleId: null })
      api.thaw()
      return out
    })
    console.log(`smoke: draw calls ${JSON.stringify(dc)}`)
    expect(dc.popups, 'a popup is on screen').toBeGreaterThan(0)
    expect(dc.base).toBeLessThanOrEqual(MAX_DRAW_CALLS)
    expect(dc.withPopups).toBeLessThanOrEqual(MAX_DRAW_CALLS)

    // Warehouse button → Warehouse (the M0 stub) → back, by real taps.
    const wh = await page.evaluate(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        L: {
          warehouse: { rect: { x: number; y: number; w: number; h: number } }
        }
      }
      return hud.L.warehouse.rect
    })
    const cx = wh.x + Math.floor(wh.w / 2)
    const cy = wh.y + Math.floor(wh.h / 2)
    const label = (): Promise<unknown> =>
      page.evaluate(() => {
        const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
          whBtn: { getData(k: string): unknown }
        }
        return hud.whBtn.getData('label')
      })
    expect(await label()).toBe('Warehouse')
    await pm.tap(cx, cy)
    await expect
      .poll(() => worlds(page))
      .toEqual({
        city: 'sleeping',
        warehouse: 'active',
      })
    await expect.poll(label).toBe('City')
    await pm.tap(cx, cy)
    await expect
      .poll(() => worlds(page))
      .toEqual({
        city: 'active',
        warehouse: 'sleeping',
      })
    await expect.poll(label).toBe('Warehouse')

    // Autosave (src/boot/autosave.ts: every 10 s of unpaused HUD time).
    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      SAVE_KEY,
      { timeout: 20_000 },
    )
    const save = await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as {
        version?: number
        seed?: number
        state?: { tick?: number }
      }
      return { version: s.version, seed: s.seed, tick: s.state?.tick }
    }, SAVE_KEY)
    console.log(`smoke: autosave ${JSON.stringify(save)}`)
    expect(save.version).toBe(1)
    expect(save.seed).toBe(7)

    // HUD hit rects at the profile width.
    expectHudHits(await hudHits(page), `W=${info.size.w}`)

    // W = 360: the chips row fits W − 12 at L1, then at L2 (the level row and
    // Industrial patched into a snapshot; levels arrive in M3).
    await page.setViewportSize({ width: 360, height: 640 })
    await expect.poll(async () => (await chipRow(page)).W).toBe(360)
    await expect.poll(() => liveChipZones(page)).toBe(4)
    const l1 = await chipRow(page)
    console.log(`smoke: chips L1 ${JSON.stringify(l1)}`)
    expect(l1.maxRowW).toBe(348)
    expect(l1.chips).toContain('industrial🔒2')
    expect(l1.rowW).toBeLessThanOrEqual(l1.maxRowW)
    expectHudHits(await hudHits(page), 'W=360 L1')
    await page.evaluate(() => {
      const api = window.__pm!
      const snap = api.snapshot() as unknown as {
        state: {
          tick: number
          level: { level: number; unlocked: string[] }
          districts: Record<
            string,
            { live: boolean; nextSpawnTick: number | null }
          >
        }
      }
      const st = snap.state
      st.level.level = 2
      st.level.unlocked.push('industrial')
      st.districts.industrial!.live = true
      st.districts.industrial!.nextSpawnTick = st.tick + 50
      api.load(snap as unknown as Parameters<typeof api.load>[0])
    })
    await expect
      .poll(async () => (await chipRow(page)).chips)
      .toContain('industrial')
    await expect.poll(() => liveChipZones(page)).toBe(5)
    const l2 = await chipRow(page)
    console.log(`smoke: chips L2 ${JSON.stringify(l2)}`)
    expect(l2.rowW).toBeLessThanOrEqual(l2.maxRowW)
    expectHudHits(await hudHits(page), 'W=360 L2')

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})
