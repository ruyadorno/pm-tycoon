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
//   M2 (§12.5 task 11, §6.9.3) — the warehouse loop: the HUD Warehouse
//      button opens the room with the pre-hired desk in slot 1 (rendered),
//      the room + readout fit between the HUD bands at 393×659 (iPhone 16)
//      and 360×604 (the minimum viewport, warehouse-view.md §1.1), a forced
//      flag (sim.debug.forceFlagNext) lands in the Hold Bay and the city
//      Warehouse button shows the badge 1, TOSS on the Hold Bay card (real
//      taps) sends it to the Quarantine Bin, and a pm:goto highlight while
//      in the room opens the BuySheet — no console errors.
//   M3 (§12.6 task 12) — L2 for real: the chips-at-360 check loads
//      tests/fixtures/level-up.json (lifetime just under L2, ?policy=1) and
//      waits for the sim's own level:up {2}: Industrial live, its chip
//      unlocked, the row still ≤ W − 12. Audio boot (?audio=1, the Title):
//      the AudioDirector exists, nothing plays before a tap (not unlocked,
//      Transport stopped, no note, SFX dropped as 'locked'), no console
//      error. Headless Chromium starts every AudioContext 'running', so the
//      plan's `ctx.state === 'suspended'` cannot be observed here
//      (e2e/audio.spec.ts has the full contract).
//   M5 (plan-build2 §8.2 task 3 + acceptance, B2 §5) — the attract Title:
//      the logo (texture 'logo', 352×176 at 1:1, centred, top safeTop + 48)
//      over a moving city (the attract sim ticks, the camera tours) with no
//      HUD, __pm.ready still false and no save written; the Credits card is
//      modal (a tap on Reset under it only closes it; Esc closes it); a real
//      New game tap swaps the sims (__pm.core !== the attract sim,
//      __pm.attractSim null), the HUD wakes, the City leaves attract mode.
//      The fps under SwiftShader is logged, not asserted.
//   M6 (plan-build2 §8.3 tasks 5-7 + acceptance; design-m6 §6, §8 G) —
//      people: the Garage buy goes through the driver picker (real taps on
//      `garage:buy:bike`, then the first applicant's card): the bike is bought
//      with that driver (fee debited, the log's buyVehicle carries the
//      applicant id, `Bike 1 bought — <name> hired`) and leaves the lot;
//      ?level=2 forces L2 on the fresh game (the log's first command, a
//      replay matches) and the StationCard's [Hire a sorter] seats the first
//      sorter applicant, who walks in to the stand under the rack lamp's S;
//      the Title's New game with ?level=3&policy=delegating is a fresh L3
//      game driven by the delegating policy (the attract sim untouched).
//      The save is version 5 (types.ts STATE_VERSION since M8).
//   M7 (plan-build2 §8.4 tasks 4-6; design-m7 §3.4, §6.4, §6.10) — quests:
//      build 3 (M11, B3 §3.2): jobs come as event cards from the deck's
//      draws — the first draw at 3:20 (firstEventS 200 s), a job with
//      probability jobShare, else a blank (decisions off) and the next draw
//      60–100 s on; under ?policy=1 the policy accepts the first job card on
//      the step it opens (the decideEvent is logged) — __pm.quests().active,
//      no card left open, the QuestChip in row B, the replay still matches;
//      the Title's New game with ?level=2&quest=rush_district is a fresh L2
//      game whose log starts debugForceLevel, debugOfferQuest (the L2 goal:
//      10 deliveries — a job card the policy-less sim holds on), the attract
//      sim untouched.
//      e2e/quests.spec.ts has the card / chip / magic / victory flows.
//   M8 (plan-build2 §8.5 tasks 3, 6; design-m8-m9 §6.1, §6.3) — L3 docks:
//      a fresh ?level=3 game in the room: dock 3's door gives its unlock
//      tooltip (`… unlocks at Lv 4 ($2,000) · coming soon`), dock 2's door
//      the `Loading dock 2` dialog, whose Buy is refused at the start
//      balance (deny tooltip, nothing bought); then level-up-3.json without
//      the policy, sim-only to L3 with $800 (tools/fixtures/m8.ts), dock 2's
//      door → Buy by real taps: `dock:bought {2}` (the log's buyDock, −$800),
//      lane.docks [dock1, dock2], the HUD toast `Loading dock 2 open — two
//      vehicles unload at once`, the replay still matches. M9: the cap is
//      L5, so dock 3's tooltip reads `… unlocks at Lv 4 ($1,000)` (no
//      `coming soon`; the text is built from economy.docks).
//   M9 (plan-build2 §8.6 task 2; design-m8-m9 §6.1 R10/R22) — room growth:
//      a fresh ?level=5 game in the room at 393×659: the 18-row room does
//      not fit (maxScroll 73), the readout stays fixed under the top band; a
//      real touch drag (CDP touch events) 40 px up scrolls the room 40 px
//      1:1 and opens nothing; scrolled, a tap on slot 6 still hits slot 6
//      (its BuySheet), and the room scrolls toward it (to maxScroll).
//      M9 review: a scroll drag ending on the bottom bar and a lift released
//      on the top band (a HUD zone takes the pointer-up) leave no stale
//      press — the ghost snaps back, slot 1 keeps its desk, the next taps
//      open BuySheets; and a real-time ?level=3 → debugForceLevel 4 in the
//      room fades the old room out on the new room's origin (gone after the
//      tier fade) with the HUD toast lane on the new room's north wall.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, gameUp, test, titleUp, type PmHelpers } from './fixtures.ts'
import {
  bayRect,
  dockHit,
  expectRoomFits,
  expectRoomScrolls,
  hireSheet,
  layoutFor,
  openSheet,
  policyOff,
  roomFit,
  roomScrollTo,
  sceneTarget,
  settleUntil,
  SORTER_STAND,
  tapRoomRect,
  tapStation,
  tapTarget,
} from './warehouse.ts'

const BASE = '/?view=gallery&debug=1&seed=1&audio=0'
const M1_URL = '/?seed=7&debug=1&skipTitle=1&audio=0&policy=1'
const AUDIO_URL = '/?seed=7&debug=1&audio=1&audiolog=1'
/** The attract Title (B2 §5): the default flow, no audio. */
const TITLE_URL = '/?seed=7&debug=1&audio=0'
/** tools/fixtures/m3.ts: 3 s before the policy's level:up {2}. */
const LEVEL_UP_FIXTURE = 'tests/fixtures/level-up.json'
/** plan.md §6.11: draw calls per frame with HUD + city + popups. */
const MAX_DRAW_CALLS = 8
/** src/sim/save.ts SAVE_KEY (build 2: save v2, plan-build2 §8.2 task 9). */
const SAVE_KEY = 'pm.save.v2'
/** src/sim/save.ts SAVE_VERSION = types.ts STATE_VERSION (6 since M11, M11 contract §2.2). */
const SAVE_VERSION = 6
/** A new game at seed 7 without the policy (the player's own buys). */
const NEW_URL = '/?seed=7&debug=1&skipTitle=1&audio=0'

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
    expect(save.version).toBe(SAVE_VERSION)
    expect(save.seed).toBe(7)

    // HUD hit rects at the profile width.
    expectHudHits(await hudHits(page), `W=${info.size.w}`)

    // W = 360: the chips row fits W − 12 at L1, then at L2 (the level-up
    // fixture under the policy, the sim's own level:up {2}).
    await page.setViewportSize({ width: 360, height: 640 })
    await expect.poll(async () => (await chipRow(page)).W).toBe(360)
    await expect.poll(() => liveChipZones(page)).toBe(4)
    const l1 = await chipRow(page)
    console.log(`smoke: chips L1 ${JSON.stringify(l1)}`)
    expect(l1.maxRowW).toBe(348)
    expect(l1.chips).toContain('industrial🔒2')
    expect(l1.rowW).toBeLessThanOrEqual(l1.maxRowW)
    expectHudHits(await hudHits(page), 'W=360 L1')
    const fx = readFileSync(LEVEL_UP_FIXTURE, 'utf8')
    const fxHash = (JSON.parse(fx) as { dataHash: string }).dataHash
    expect(
      fxHash,
      `${LEVEL_UP_FIXTURE} is stale: run \`node tools/fixtures/m3.ts\``,
    ).toBe(await page.evaluate(() => window.__pm!.data.hash))
    const up = await page.evaluate(async (json) => {
      const api = window.__pm!
      api.load(json)
      const w = await api.waitEvent('level:up', 15_000)
      return {
        ok: w.ok,
        level: w.payload?.level ?? null,
        industrial: api.sim.regionState('industrial'),
      }
    }, fx)
    console.log(`smoke: level-up fixture ${JSON.stringify(up)}`)
    expect(up).toEqual({ ok: true, level: 2, industrial: 'live' })
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

// ---- M2 ------------------------------------------------------------------

/** The city Warehouse button's badge text (null when none). */
function warehouseBadge(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      whBtn: { badge: { list: { text?: string }[] } | null }
    }
    return hud.whBtn.badge?.list[1]?.text ?? null
  })
}

/** Real tap on the HUD Warehouse / City button, then wait for `to`. */
async function switchView(
  page: Page,
  pm: PmHelpers,
  to: 'city' | 'warehouse',
): Promise<void> {
  const r = await page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      L: {
        warehouse: { rect: { x: number; y: number; w: number; h: number } }
      }
    }
    return hud.L.warehouse.rect
  })
  await pm.tap(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2))
  const want = to === 'city' ? 'City' : 'Warehouse'
  const ok = await settleUntil(page, pm, async () => {
    const w = await worlds(page)
    const active = to === 'city' ? w.city : w.warehouse
    return active === 'active'
  })
  expect(ok, `${want} is active after the button tap`).toBe(true)
  // The 120 ms fade out + 150 ms fade in / 16 px drop (§5.3).
  await pm.settle(24)
}

test.describe('M2 warehouse smoke', () => {
  test('warehouse: desk in slot 1, fits 393×659 and 360×604, forced flag → Hold Bay + badge 1, Toss', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(M1_URL)
    await pm.freeze()
    // Opening A (policy): a bike + the Metal detector at t = 0; parcels
    // run through the lane well before 60 s. Then the policy stops, so the
    // forced flag stays in the Hold Bay (it Tosses every flag next tick).
    await pm.advance(60_000)
    await pm.settle(10)
    await policyOff(page)

    // City → Warehouse by a real tap on the HUD button.
    await switchView(page, pm, 'warehouse')
    const lane = await page.evaluate(() => {
      const api = window.__pm!
      const nodes = api.sim.lane.nodes()
      const slot1 = nodes.find((n) => n.id === 'slot1')
      const wh = api.game.scene.getScene('Warehouse') as unknown as {
        lane: {
          fixtureImage(
            id: string,
          ): { visible: boolean; frame: { name: string } } | null
        }
      }
      const img = wh.lane.fixtureImage('slot1')
      const fx = slot1?.fixture ?? null
      return {
        nodes: nodes.map((n) => n.id),
        slot1: fx?.kind ?? null,
        inspectors: fx?.kind === 'desk' ? fx.inspectorIds.length : 0,
        deskFrame: img?.frame.name ?? null,
        deskVisible: img?.visible ?? false,
      }
    })
    console.log(`smoke: warehouse lane ${JSON.stringify(lane)}`)
    for (const id of ['dock1', 'conv1', 'slot1', 'slot2', 'slot3', 'hold'])
      expect(lane.nodes).toContain(id)
    expect(lane.slot1, 'slot 1 holds the pre-hired desk').toBe('desk')
    expect(lane.inspectors).toBeGreaterThanOrEqual(1)
    expect(lane.deskFrame ?? '').toMatch(/desk/)
    expect(lane.deskVisible).toBe(true)
    expectRoomFits(await roomFit(page), 'W=393 H=659')

    // Back in the city, a forced flag lands in the Hold Bay → badge 1.
    await switchView(page, pm, 'city')
    await page.evaluate(() => window.__pm!.sim.debug!.forceFlagNext('metal'))
    const held = await page.evaluate(() =>
      window.__pm!.waitEvent('parcel:held'),
    )
    console.log(`smoke: forced flag ${JSON.stringify(held)}`)
    expect(held.ok, 'the forced flag is held within 60 s').toBe(true)
    await pm.settle(4)
    expect(await page.evaluate(() => window.__pm!.sim.holdBay.count)).toBe(1)
    expect(await warehouseBadge(page)).toBe('1')

    // Warehouse → tap bay 1 → the Hold Bay card → TOSS (real taps).
    await switchView(page, pm, 'warehouse')
    await pm.settle(40) // the divert into the bay
    await tapRoomRect(page, pm, bayRect(0))
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'hold',
      ),
      'the Hold Bay card opens',
    ).toBe(true)
    await pm.settle(16) // the 150 ms tap guard + the slide-in
    const q0 = await page.evaluate(() => window.__pm!.sim.quarantine.count)
    await tapTarget(page, pm, 'Warehouse', 'hold:toss')
    expect(
      await settleUntil(
        page,
        pm,
        async () =>
          (await page.evaluate(() => window.__pm!.sim.holdBay.count)) === 0,
      ),
      'TOSS empties the bay',
    ).toBe(true)
    const q1 = await page.evaluate(() => window.__pm!.sim.quarantine)
    console.log(`smoke: after Toss quarantine ${JSON.stringify(q1)}`)
    expect(q1.count).toBe(q0 + 1)
    expect(await openSheet(page)).toBeNull()

    // pm:goto {warehouse, highlight} while already here (the lost-life
    // card's Open warehouse) opens the BuySheet on the first empty slot.
    await page.evaluate(() =>
      window.__pm!.game.events.emit('pm:goto', {
        view: 'warehouse',
        highlight: 'metal_detector',
      }),
    )
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'buy',
      ),
      'the highlight opens the BuySheet in the awake room',
    ).toBe(true)
    await page.keyboard.press('Escape')
    expect(
      await settleUntil(page, pm, async () => (await openSheet(page)) === null),
      'Esc closes the BuySheet',
    ).toBe(true)

    // The 360×604 minimum viewport still fits (warehouse-view.md §1.1).
    await page.setViewportSize({ width: 360, height: 604 })
    expect(
      await settleUntil(page, pm, async () => {
        const f = await roomFit(page)
        return f.W === 360 && f.H === 604
      }),
      'the game resized to 360×604',
    ).toBe(true)
    await pm.settle(4)
    expectRoomFits(await roomFit(page), 'W=360 H=604')

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

// ---- M3 ------------------------------------------------------------------

test.describe('M3 audio boot smoke', () => {
  test('audio on: the director exists, nothing plays before the Title tap, no console error', async ({
    page,
    consoleErrors,
  }) => {
    await page.goto(AUDIO_URL)
    await page.waitForFunction(
      () => {
        const pm = window.__pm
        return !!pm?.audio && pm.game.scene.isActive('Title')
      },
      null,
      { timeout: 45_000 },
    )
    // A few frames of the Title (the zzfx renders run one per macrotask).
    await page.waitForTimeout(500)
    const pre = await page.evaluate(() => {
      const api = window.__pm!
      const a = api.audio!
      api.game.events.emit('ui:tap', { id: 'smoke' })
      const played = a.sfx('buy')
      const st = a.state()
      return {
        director: !!a.director,
        played,
        ctxState: st.ctxState,
        disabled: st.disabled,
        unlocked: st.unlocked,
        transport: st.transport.state,
        notes: a.log.notes().length,
        sfx: a.log.sfxEntries().map((e) => `${e.sfx}:${e.dropped ?? ''}`),
        errors: st.errors,
      }
    })
    console.log(`smoke: audio before the tap ${JSON.stringify(pre)}`)
    expect(pre.director).toBe(true)
    expect(pre.disabled).toBe(false)
    expect(pre.unlocked).toBe(false)
    expect(pre.transport).toBe('stopped')
    expect(pre.notes).toBe(0)
    expect(pre.played).toBe(false)
    expect(pre.sfx).toEqual(['tap:locked', 'buy:locked'])
    expect(pre.errors).toEqual([])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

// ---- M5 ------------------------------------------------------------------

interface TitleProbe {
  W: number
  safeTop: number
  logo: {
    key: string
    x: number
    y: number
    w: number
    h: number
    visible: boolean
    scale: number
  } | null
  hud: boolean
  cityAttract: boolean | null
  coreIsAttract: boolean
  ready: boolean
  vehicles: number
  tick: number
  scroll: { x: number; y: number }
  zoom: number
  fps: number
  drawCalls: number
}

function probeTitle(page: Page): Promise<TitleProbe> {
  return page.evaluate((): TitleProbe => {
    type Img = {
      texture: { key: string }
      x: number
      y: number
      width: number
      height: number
      visible: boolean
      scaleX: number
      getData?(k: string): unknown
    }
    const api = window.__pm!
    const sm = api.game.scene
    const title = sm.getScene('Title') as unknown as {
      children: { list: Img[] }
    }
    const logo = title.children.list.find(
      (o) => o.getData?.('id') === 'title:logo',
    )
    const city = sm.getScene('City') as unknown as {
      attract?: boolean
      cameras: { main: { scrollX: number; scrollY: number; zoom: number } }
    }
    const cam = city.cameras.main
    return {
      W: api.game.scale.width,
      safeTop: (api.game.registry.get('safeTop') as number | undefined) ?? 0,
      logo: logo
        ? {
            key: logo.texture.key,
            x: logo.x,
            y: logo.y,
            w: logo.width,
            h: logo.height,
            visible: logo.visible,
            scale: logo.scaleX,
          }
        : null,
      hud: sm.isActive('HUD') && !sm.isSleeping('HUD'),
      cityAttract: sm.isActive('City') ? city.attract === true : null,
      coreIsAttract: api.attractSim !== null && api.core === api.attractSim,
      ready: api.ready,
      vehicles: api.core.state.vehicles.length,
      tick: api.core.state.tick,
      scroll: { x: cam.scrollX, y: cam.scrollY },
      zoom: cam.zoom,
      fps: Math.round(api.game.loop.actualFps * 10) / 10,
      drawCalls: api.metrics().drawCalls,
    }
  })
}

interface FogProbe {
  /** City lockState for Industrial. */
  locked: boolean | null
  /** Frame names of the Industrial buildings' images. */
  frames: string[]
  /** Smoke emitters built (only over live Industrial chimneys). */
  smoke: number
}

/** Industrial's fog state as the City draws it (B2 §5 swap check). */
function probeFog(page: Page): Promise<FogProbe> {
  return page.evaluate((): FogProbe => {
    const city = window.__pm!.game.scene.getScene('City') as unknown as {
      lockState: Map<string, boolean>
      byDistrict: Map<string, { image: { frame: { name: string } } | null }[]>
      smoke: unknown[]
    }
    const views = city.byDistrict.get('industrial') ?? []
    return {
      locked: city.lockState.get('industrial') ?? null,
      frames: views.flatMap((v) => (v.image ? [v.image.frame.name] : [])),
      smoke: city.smoke.length,
    }
  })
}

function titleDialogOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const t = window.__pm!.game.scene.getScene('Title') as unknown as {
      dialog: { isOpen(): boolean } | null
    }
    return t.dialog?.isOpen() ?? false
  })
}

function creditsOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const t = window.__pm!.game.scene.getScene('Title') as unknown as {
      creditsOpen(): boolean
    }
    return t.creditsOpen()
  })
}

test.describe('M5 attract title smoke', () => {
  test('the logo over a moving attract city, no HUD, modal Credits; New game swaps the sims and wakes the HUD', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await page.goto(TITLE_URL)
    await page.evaluate(() => localStorage.clear())
    await page.goto(TITLE_URL)
    await titleUp(page)

    const t0 = await probeTitle(page)
    console.log(`smoke: attract title ${JSON.stringify(t0)}`)
    expect(t0.logo, 'the logo image on the Title').not.toBeNull()
    expect(t0.logo!.key).toBe('logo')
    expect([t0.logo!.w, t0.logo!.h]).toEqual([352, 176])
    expect(t0.logo!.scale, 'drawn at 1:1').toBe(1)
    expect(t0.logo!.visible).toBe(true)
    expect(t0.logo!.x).toBe(Math.round((t0.W - 352) / 2))
    expect(t0.logo!.y).toBe(t0.safeTop + 48)
    expect(t0.hud, 'no HUD on the Title').toBe(false)
    expect(t0.cityAttract, 'the City runs in attract mode').toBe(true)
    expect(t0.coreIsAttract, 'the attract sim is installed').toBe(true)
    expect(t0.ready, '__pm.ready waits for the player’s game').toBe(false)
    expect(t0.zoom).toBe(1)
    expect(
      t0.vehicles,
      'the L2 attract city: ≥ 4 vehicles',
    ).toBeGreaterThanOrEqual(4)

    // A moving city: the sim ticks at 1× and the camera leaves the lot after
    // its 1-s hold.
    await page.waitForTimeout(2500)
    const t1 = await probeTitle(page)
    console.log(
      `smoke: attract after 2.5 s: tick +${t1.tick - t0.tick}, camera ` +
        `(${t0.scroll.x},${t0.scroll.y}) → (${t1.scroll.x},${t1.scroll.y}), ` +
        `fps ${t1.fps} under SwiftShader (logged, not asserted), draw calls ${t1.drawCalls}`,
    )
    test.info().annotations.push({
      type: 'attract fps (SwiftShader)',
      description: String(t1.fps),
    })
    expect(t1.tick - t0.tick, 'the attract sim ticks').toBeGreaterThan(5)
    expect(
      t1.scroll.x !== t0.scroll.x || t1.scroll.y !== t0.scroll.y,
      'the camera drifts',
    ).toBe(true)
    expect(t1.hud).toBe(false)
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith('pm.save')),
      ),
      'the attract sim is never saved',
    ).toEqual([])

    // Credits is modal (report §6.11): a tap on Reset under it only closes
    // the card, Esc closes it too.
    await tapTarget(page, pm, 'Title', 'title:credits')
    await expect.poll(() => creditsOpen(page)).toBe(true)
    await tapTarget(page, pm, 'Title', 'title:reset')
    await expect.poll(() => creditsOpen(page)).toBe(false)
    expect(await titleDialogOpen(page), 'Reset did not open over Credits').toBe(
      false,
    )
    await tapTarget(page, pm, 'Title', 'title:credits')
    await expect.poll(() => creditsOpen(page)).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => creditsOpen(page)).toBe(false)
    expect(await titleDialogOpen(page)).toBe(false)

    // The attract city (L2) has Industrial live: colour frames, smoke on.
    const fogBefore = await probeFog(page)
    console.log(`smoke: attract Industrial ${JSON.stringify(fogBefore)}`)
    expect(fogBefore.locked, 'Industrial is live in the attract city').toBe(
      false,
    )
    expect(fogBefore.frames.length).toBeGreaterThan(0)
    expect(fogBefore.frames.filter((f) => f.endsWith('_locked'))).toEqual([])

    // New game: the player's sim replaces the attract sim under the fade.
    await page.evaluate(() => {
      ;(window as unknown as { pmAttract: unknown }).pmAttract =
        window.__pm!.attractSim
    })
    await tapTarget(page, pm, 'Title', 'title:new-game')
    await gameUp(page)
    // The swap re-fogs what the demo had unlocked (B2 §5: applyLockState
    // snaps + the ground re-bake): Industrial locked again, `_locked`
    // frames, no chimney smoke.
    const fogAfter = await probeFog(page)
    console.log(`smoke: Industrial after New game ${JSON.stringify(fogAfter)}`)
    expect(fogAfter.locked, 'Industrial is fogged again').toBe(true)
    expect(fogAfter.frames.length).toBe(fogBefore.frames.length)
    expect(
      fogAfter.frames.filter((f) => !f.endsWith('_locked')),
      'every Industrial building shows its _locked frame',
    ).toEqual([])
    expect(fogAfter.smoke, 'no smoke over a fogged Industrial').toBe(0)
    const after = await page.evaluate(() => {
      const api = window.__pm!
      const sm = api.game.scene
      const city = sm.getScene('City') as unknown as {
        attract: boolean
        vehicles: Map<number, unknown>
        input: { enabled: boolean }
        cameras: { main: { zoom: number } }
      }
      const prev = (window as unknown as { pmAttract: unknown }).pmAttract
      return {
        swapped: prev !== null && api.core !== prev,
        attractSim: api.attractSim,
        hud: sm.isActive('HUD') && !sm.isSleeping('HUD'),
        title: sm.isActive('Title'),
        cityAttract: city.attract,
        cityInput: city.input.enabled,
        zoom: city.cameras.main.zoom,
        seed: api.seed,
        tick: api.core.state.tick,
        level: api.core.state.level.level,
        views: city.vehicles.size,
        simVehicles: api.core.state.vehicles.length,
        policy: (api.stepper as unknown as { policy: unknown }).policy,
      }
    })
    console.log(`smoke: after New game ${JSON.stringify(after)}`)
    expect(after.swapped, '__pm.core !== the attract sim').toBe(true)
    expect(after.attractSim).toBeNull()
    expect(after.hud, 'the HUD is awake').toBe(true)
    expect(after.title).toBe(false)
    expect(after.cityAttract).toBe(false)
    expect(after.cityInput).toBe(true)
    expect(after.zoom).toBe(1)
    expect(after.seed).toBe(7)
    expect(after.level).toBe(1)
    expect(after.tick, 'a fresh run').toBeLessThan(600)
    expect(after.views, 'no attract vehicle left in the city').toBe(
      after.simVehicles,
    )
    expect(after.policy, 'no policy drives the player’s game').toBeNull()

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('a failed policy chunk is never fatal: the Title on the plain backdrop', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    // The attract city's competent policy is a separate chunk (src/main.ts
    // importPolicy); a flaky network or a redeploy race must not show the
    // "Boot failed" card, and no policy-less demo city (its lane stalls).
    let blocked = 0
    await page.route(/\/assets\/policy-[\w-]+\.js$/, (route) => {
      blocked++
      return route.abort('failed')
    })
    await page.goto(TITLE_URL)
    await titleUp(page, false)
    await page.waitForTimeout(300)
    const st = await page.evaluate(() => {
      const api = window.__pm!
      const sm = api.game.scene
      return {
        card: document.getElementById('pm-card')?.textContent ?? null,
        city: sm.isActive('City'),
        attractSim: api.attractSim !== null,
        createPolicy: api.game.registry.get('createPolicy') ?? null,
        held: api.stepper.paused,
      }
    })
    console.log(`smoke: policy chunk blocked ×${blocked} ${JSON.stringify(st)}`)
    expect(blocked, 'the policy chunk was requested').toBeGreaterThan(0)
    expect(st).toEqual({
      card: null,
      city: false,
      attractSim: false,
      createPolicy: null,
      held: true,
    })
    // New game still works from the plain Title.
    await tapTarget(page, pm, 'Title', 'title:new-game')
    await gameUp(page)
    // Only the aborted request's own network line, nothing from the game.
    expect(
      consoleErrors.filter((e) => !/Failed to load resource|policy-/.test(e)),
      consoleErrors.join('\n'),
    ).toEqual([])
  })
})

// ---- M6 ------------------------------------------------------------------

/** Real tap on the HUD Garage button; the sheet slides in. */
async function openGarage(page: Page, pm: PmHelpers): Promise<void> {
  const r = await page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      L: { garage: { rect: { x: number; y: number; w: number; h: number } } }
    }
    return hud.L.garage.rect
  })
  await pm.tap(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2))
  expect(
    await settleUntil(page, pm, () =>
      page.evaluate(() => {
        const g = window.__pm!.game.scene.getScene('Garage') as unknown as {
          garageSheet: { isOpen(): boolean } | null
        }
        return g.garageSheet?.isOpen() ?? false
      }),
    ),
    'the Garage sheet opens',
  ).toBe(true)
  await pm.settle(24)
}

/** The HUD toast's current text ('' when none). */
function toastText(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (
        window.__pm!.game.scene.getScene('HUD') as unknown as {
          toast: { currentText(): string | null }
        }
      ).toast.currentText() ?? '',
  )
}

test.describe('M6 people smoke', () => {
  test('the Garage buy goes through the driver picker: the first applicant drives the new bike', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(NEW_URL)
    await pm.freeze()
    await pm.settle(10)
    const before = await page.evaluate(() => {
      const api = window.__pm!
      const a = api.sim.applicants('driver', 'bike')[0]!
      return {
        vehicles: api.sim.vehicles.length,
        money: api.sim.money,
        price: api.data.vehicles.types.find((t) => t.id === 'bike')!.price,
        applicant: { id: a.id, name: a.name, fee: a.hireFee },
      }
    })
    console.log(`smoke: before the buy ${JSON.stringify(before)}`)
    expect(before.vehicles, 'a new game owns no vehicle').toBe(0)

    await openGarage(page, pm)
    await tapTarget(page, pm, 'Garage', 'garage:buy:bike')
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await hireSheet(page, 'Garage')) !== null,
      ),
      'the Bike buy card opens the driver picker',
    ).toBe(true)
    await pm.settle(16) // the slide-in + the tap guard
    const sheet = await hireSheet(page, 'Garage')
    console.log(`smoke: driver picker ${JSON.stringify(sheet)}`)
    expect(sheet).toMatchObject({ id: 'garage:hire', role: 'driver' })
    expect(sheet!.ids).toHaveLength(3)
    expect(sheet!.ids[0]).toBe(before.applicant.id)

    await tapTarget(page, pm, 'Garage', 'garage:hire:card:0')
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await hireSheet(page, 'Garage')) === null,
      ),
      'Hire closes the picker',
    ).toBe(true)
    const after = await page.evaluate(() => {
      const api = window.__pm!
      const v = api.sim.vehicles[0] ?? null
      const d = api.sim.people().find((p) => p.id === v?.driverId) ?? null
      const buys = api.core.commandLog
        .map((e) => e.cmd)
        .filter((c) => c.kind === 'buyVehicle')
      return {
        vehicles: api.sim.vehicles.length,
        type: v?.type ?? null,
        name: v?.name ?? null,
        driverName: v?.driverName ?? null,
        driver: d ? { role: d.role, vehicleId: d.vehicleId } : null,
        vehicleId: v?.id ?? null,
        money: api.sim.money,
        buys,
      }
    })
    console.log(`smoke: after the buy ${JSON.stringify(after)}`)
    expect(after.vehicles).toBe(1)
    expect(after.type).toBe('bike')
    expect(after.driverName, 'the picked applicant drives it').toBe(
      before.applicant.name,
    )
    expect(after.driver).toEqual({ role: 'driver', vehicleId: after.vehicleId })
    expect(after.money).toBe(before.money - before.price - before.applicant.fee)
    expect(after.buys).toEqual([
      { kind: 'buyVehicle', type: 'bike', applicantId: before.applicant.id },
    ])
    expect(
      await settleUntil(page, pm, async () =>
        (await toastText(page)).startsWith(`${after.name} bought`),
      ),
      'the buy toast',
    ).toBe(true)
    expect(await toastText(page)).toBe(
      `${after.name} bought — ${before.applicant.name} hired`,
    )

    // The driver drives: the bike goes out and picks a parcel up.
    const pick = await page.evaluate(() =>
      window.__pm!.waitEvent('parcel:pickedUp'),
    )
    console.log(`smoke: first pickup ${JSON.stringify(pick)}`)
    expect(pick.ok, 'the new bike picks a parcel up within 60 s').toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('a Hire-later bike keeps Sell in its ··· popover (Hire driver first) and sells', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(NEW_URL)
    await pm.freeze()
    await pm.settle(10)
    // Bike 1 with its cheapest applicant (so Sell is open on Bike 2), then
    // Bike 2 through Hire later: parked, no driver.
    const ids = await page.evaluate(() => {
      const vs = window.__pm!.sim
      const cheap = [...vs.applicants('driver', 'bike')].sort(
        (a, b) => a.hireFee - b.hireFee,
      )[0]!
      const a = vs.buyVehicle('bike', cheap.id)
      const b = vs.buyVehicle('bike', null)
      return {
        a: a.ok ? (a.vehicleId ?? null) : null,
        b: b.ok ? (b.vehicleId ?? null) : null,
      }
    })
    console.log(`smoke: hire-later fleet ${JSON.stringify(ids)}`)
    expect(ids.a).not.toBeNull()
    expect(ids.b).not.toBeNull()

    await openGarage(page, pm)
    await tapTarget(page, pm, 'Garage', `garage:action:${ids.b}`)
    const live = (id: string) =>
      sceneTarget(page, 'Garage', id).then((r) => r !== null)
    expect(
      await settleUntil(page, pm, () => live('garage:menu:sell')),
      'the driverless row opens its ··· popover',
    ).toBe(true)
    await pm.settle(8)
    const menu = {
      hire: await live('garage:menu:hire'),
      rehire: await live('garage:menu:rehire'),
      replace: await live('garage:menu:replace'),
      fire: await live('garage:menu:fire'),
      sell: await live('garage:menu:sell'),
    }
    console.log(`smoke: driverless popover ${JSON.stringify(menu)}`)
    expect(menu).toEqual({
      hire: true,
      rehire: false,
      replace: false,
      fire: false,
      sell: true,
    })

    await tapTarget(page, pm, 'Garage', 'garage:menu:sell')
    expect(
      await settleUntil(page, pm, () => live('garage:sellDialog:confirm')),
      'Sell asks first',
    ).toBe(true)
    await pm.settle(8)
    await tapTarget(page, pm, 'Garage', 'garage:sellDialog:confirm')
    expect(
      await settleUntil(page, pm, () =>
        page.evaluate(
          (id) => !window.__pm!.sim.vehicles.some((v) => v.id === id),
          ids.b!,
        ),
      ),
      'the Hire-later bike is sold',
    ).toBe(true)
    expect(
      await page.evaluate(() => window.__pm!.sim.vehicles.map((v) => v.id)),
    ).toEqual([ids.a])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('?level=2 forces L2 on the fresh game; the StationCard hires a sorter who walks to the stand', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(`${NEW_URL}&view=warehouse&level=2`)
    const forced = await page.evaluate(() => {
      const api = window.__pm!
      const first = api.core.commandLog[0] ?? null
      const r = api.replay()
      return {
        level: api.sim.level,
        first: first ? { tick: first.tick, cmd: first.cmd } : null,
        unlocked: api.sim.holdStation.unlocked,
        kind: api.sim.holdStation.kind,
        replay: r.matches,
      }
    })
    console.log(`smoke: ?level=2 ${JSON.stringify(forced)}`)
    expect(forced).toEqual({
      level: 2,
      first: { tick: 0, cmd: { kind: 'debugForceLevel', level: 2 } },
      unlocked: true,
      kind: null,
      replay: true,
    })

    await pm.freeze()
    await pm.settle(30)
    await tapStation(page, pm)
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'station',
      ),
      'a tap on the station opens the StationCard',
    ).toBe(true)
    await pm.settle(16)
    await tapTarget(page, pm, 'Warehouse', 'station:hire')
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'hire',
      ),
      '[Hire a sorter] opens the HireSheet',
    ).toBe(true)
    await pm.settle(16)
    const sheet = await hireSheet(page, 'Warehouse')
    console.log(`smoke: sorter picker ${JSON.stringify(sheet)}`)
    expect(sheet).toMatchObject({ id: 'wh:hire', role: 'sorter' })
    expect(sheet!.ids).toHaveLength(3)
    await tapTarget(page, pm, 'Warehouse', 'wh:hire:card:0')
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) !== 'hire',
      ),
      'Hire closes the HireSheet',
    ).toBe(true)
    // The tap is handled at once; WorkerSprites reconciles on the next frames.
    await pm.settle(4)
    const seated = await page.evaluate(() => {
      const hs = window.__pm!.sim.holdStation
      return {
        kind: hs.kind,
        id: hs.sorter?.id ?? null,
        name: hs.sorter?.name ?? null,
        active: hs.sorter?.active ?? null,
      }
    })
    console.log(`smoke: sorter seated ${JSON.stringify(seated)}`)
    expect(seated.kind).toBe('sorter')
    expect(seated.name).toBe(sheet!.names[0])
    expect(seated.active).toBe(true)

    // The sprite walks in from the dock door (~9 s at 64 px/s, lane F).
    const walk = (): Promise<{
      walking: boolean
      at: { x: number; y: number } | null
      badge: boolean
    }> =>
      page.evaluate((id) => {
        const wh = window.__pm!.game.scene.getScene('Warehouse') as unknown as {
          workers: {
            isWalking(id: number): boolean
            positionOf(id: number): { x: number; y: number } | null
          }
          lane: { sBadge: { visible: boolean } }
        }
        return {
          walking: wh.workers.isWalking(id),
          at: wh.workers.positionOf(id),
          badge: wh.lane.sBadge.visible,
        }
      }, seated.id!)
    expect((await walk()).at, 'the sorter has a sprite').not.toBeNull()
    const frames = await page.evaluate((id) => {
      const api = window.__pm!
      const wh = api.game.scene.getScene('Warehouse') as unknown as {
        workers: { isWalking(id: number): boolean }
      }
      let n = 0
      while (wh.workers.isWalking(id) && n < 1200) {
        api.step(16)
        n++
      }
      return n
    }, seated.id!)
    console.log(`smoke: the sorter walked in for ${frames} frames`)
    expect(frames, 'the sorter reaches the stand').toBeLessThan(1200)
    const w = await walk()
    console.log(`smoke: sorter at ${JSON.stringify(w)}`)
    expect(w.at).toEqual({ x: SORTER_STAND.x, y: SORTER_STAND.y })
    expect(w.badge, 'the rack lamp shows S').toBe(true)
    expect(await page.evaluate(() => window.__pm!.replay().matches)).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('Title → New game with ?level=3&policy=delegating: a fresh L3 game, the delegating policy, the attract sim untouched', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    const url = '/?seed=7&debug=1&audio=0&level=3&policy=delegating'
    await page.goto(url)
    await page.evaluate(() => localStorage.clear())
    await page.goto(url)
    await titleUp(page)
    const attract = await page.evaluate(() => {
      const s = window.__pm!.attractSim!
      return {
        forced: s.commandLog.some((e) => e.cmd.kind === 'debugForceLevel'),
        params: {
          level: window.__pm!.params.level,
          kind: window.__pm!.params.policyKind,
        },
      }
    })
    console.log(`smoke: attract under ?level=3 ${JSON.stringify(attract)}`)
    expect(attract).toEqual({
      forced: false,
      params: { level: 3, kind: 'delegating' },
    })
    await tapTarget(page, pm, 'Title', 'title:new-game')
    await gameUp(page)
    const game = await page.evaluate(() => {
      const api = window.__pm!
      const first = api.core.commandLog[0] ?? null
      const pol = (
        api.stepper as unknown as { policy: { name?: string } | null }
      ).policy
      return {
        level: api.sim.level,
        first: first ? { tick: first.tick, cmd: first.cmd } : null,
        policy: pol?.name ?? null,
        docks: api.sim.regionState('docks'),
      }
    })
    console.log(`smoke: New game under ?level=3 ${JSON.stringify(game)}`)
    expect(game).toEqual({
      level: 3,
      first: { tick: 0, cmd: { kind: 'debugForceLevel', level: 3 } },
      policy: 'delegating',
      docks: 'live',
    })
    // A minute of the delegating policy at L3: it keeps the game running.
    await pm.freeze()
    await pm.advance(60_000)
    await pm.settle(8)
    const m = await page.evaluate(() => window.__pm!.metrics())
    console.log(
      `smoke: delegating at L3 after 60 s: $${m.money} lv ${m.level} lives ${m.lives} deliveries ${m.deliveries}`,
    )
    expect(m.level).toBeGreaterThanOrEqual(3)
    expect(m.lives, 'still in the game').toBeGreaterThan(0)
    expect(await page.evaluate(() => window.__pm!.replay().matches)).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

/** events.json schedule.firstEventS 200 s → the deck's first draw at tick 2000 (B3 §3.2). */
const FIRST_DRAW_TICK = 2000

test.describe('M7 quests smoke', () => {
  test('the policy accepts the first job card (3:20 or a later draw): __pm.quests().active, the chip; the replay matches', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(M1_URL)
    await pm.freeze()
    // Nothing before the deck's first draw (firstEventS 200 s).
    await pm.advance(199_000)
    let qs = await page.evaluate(() => window.__pm!.quests())
    expect(qs.offer, 'no job before 3:20').toBeNull()
    expect(qs.active).toBeNull()
    expect(qs.history).toEqual([])
    expect(qs.nextOfferInTicks).toBeGreaterThan(0)
    // A draw is a job with probability jobShare (else a blank and the next
    // draw 60–100 s on): poll in 10-s steps until the policy took one.
    await pm.advance(1_000)
    for (let i = 0; i < 30; i++) {
      qs = await page.evaluate(() => window.__pm!.quests())
      if (qs.active !== null) break
      await pm.advance(10_000)
    }
    await pm.settle(10)
    qs = await page.evaluate(() => window.__pm!.quests())
    const st = await page.evaluate(() => {
      const api = window.__pm!
      const log = api.core.commandLog
      const decide = log.find((e) => e.cmd.kind === 'decideEvent')
      const hud = api.game.scene.getScene('HUD') as unknown as {
        questChip: { current: { visible: boolean; barText: string } }
      }
      return {
        decide: decide ? { tick: decide.tick, cmd: decide.cmd } : null,
        open: api.events().open?.eventId ?? null,
        chip: hud.questChip.current,
      }
    })
    console.log(
      `smoke: first job ${qs.active?.templateId ?? '-'} offered ${qs.active?.offeredTick ?? '-'} ${JSON.stringify(st)}`,
    )
    expect(qs.active, 'the policy accepted the first job card').not.toBeNull()
    expect(qs.active!.offeredTick).toBeGreaterThanOrEqual(FIRST_DRAW_TICK)
    expect(qs.offer).toBeNull()
    expect(st.open, 'no card left open under the policy').toBeNull()
    // The policy answers on the step after the tick that opened the card.
    expect(st.decide?.cmd).toEqual({
      kind: 'decideEvent',
      eventId: `job:${qs.active!.templateId}`,
      option: 0,
    })
    expect(st.decide!.tick).toBeGreaterThanOrEqual(qs.active!.offeredTick)
    expect(st.decide!.tick).toBeLessThanOrEqual(qs.active!.offeredTick + 1)
    expect(st.chip.visible, 'the QuestChip shows in row B').toBe(true)
    expect(await page.evaluate(() => window.__pm!.replay().matches)).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('no policy: a non-job card (the loaner, debug.offerEvent) holds the sim and the stepper, then the interim HUD answers it with its default (review deck-1/deck-2)', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open('/?seed=7&debug=1&skipTitle=1&audio=0')
    await pm.freeze()
    await pm.settle(5)
    const before = await page.evaluate(() => {
      const api = window.__pm!
      const r = api.sim.debug!.offerEvent('ev_luck_loaner')
      return {
        ok: r.ok,
        open: api.events().open?.eventId ?? null,
        held: api.core.held,
        vehicles: api.sim.vehicles.length,
      }
    })
    expect(before).toMatchObject({
      ok: true,
      open: 'ev_luck_loaner',
      held: true,
    })
    // Held, the stepper runs nothing (no no-op ticks): advance() reports 0.
    expect(await page.evaluate(() => window.__pm!.advance(1_000))).toBe(0)
    await pm.settle(5)
    const after = await page.evaluate(() => {
      const api = window.__pm!
      const log = api.core.commandLog
      const decide = log.findLast((e) => e.cmd.kind === 'decideEvent')
      return {
        open: api.events().open?.eventId ?? null,
        held: api.core.held,
        vehicles: api.sim.vehicles.length,
        decide: decide?.cmd ?? null,
        tick: api.sim.tick,
      }
    })
    expect(after.open, 'the interim HUD answered the loaner').toBeNull()
    expect(after.held).toBe(false)
    expect(after.vehicles).toBe(before.vehicles + 1)
    expect(after.decide).toEqual({
      kind: 'decideEvent',
      eventId: 'ev_luck_loaner',
      option: 0,
    })
    await pm.settle(30)
    expect(await page.evaluate(() => window.__pm!.sim.tick)).toBeGreaterThan(
      after.tick,
    )
    expect(await page.evaluate(() => window.__pm!.replay().matches)).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('Title → New game with ?level=2&quest=rush_district: the L2 offer on the fresh game, the attract sim untouched', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    const url = '/?seed=7&debug=1&audio=0&level=2&quest=rush_district'
    await page.goto(url)
    await page.evaluate(() => localStorage.clear())
    await page.goto(url)
    await titleUp(page)
    const attract = await page.evaluate(() => {
      const s = window.__pm!.attractSim!
      return {
        logged: s.commandLog.some((e) => e.cmd.kind === 'debugOfferQuest'),
        quest: window.__pm!.params.quest,
      }
    })
    expect(attract).toEqual({ logged: false, quest: 'rush_district' })
    await tapTarget(page, pm, 'Title', 'title:new-game')
    await gameUp(page)
    await pm.freeze()
    await pm.settle(10)
    const game = await page.evaluate(() => {
      const api = window.__pm!
      const qs = api.quests()
      return {
        level: api.sim.level,
        log: api.core.commandLog.map((e) => ({ tick: e.tick, cmd: e.cmd })),
        offer: qs.offer
          ? {
              templateId: qs.offer.templateId,
              goal: qs.offer.goal,
              offeredTick: qs.offer.offeredTick,
            }
          : null,
      }
    })
    console.log(`smoke: New game under ?quest= ${JSON.stringify(game)}`)
    expect(game).toEqual({
      level: 2,
      log: [
        { tick: 0, cmd: { kind: 'debugForceLevel', level: 2 } },
        {
          tick: 0,
          cmd: { kind: 'debugOfferQuest', templateId: 'rush_district' },
        },
      ],
      offer: { templateId: 'rush_district', goal: 10, offeredTick: 0 },
    })
    expect(await page.evaluate(() => window.__pm!.replay().matches)).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

/** tools/fixtures/m8.ts: 3 s before the policy's real level:up {3}. */
const LEVEL_UP_3_FIXTURE = 'tests/fixtures/level-up-3.json'

/** Record every pm:tooltip text the scenes emit (window.pmTips). */
function recordTooltips(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as { pmTips: string[] }
    w.pmTips = []
    window.__pm!.game.events.on('pm:tooltip', (p: { text: string }) =>
      w.pmTips.push(p.text),
    )
  })
}

function tooltips(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { pmTips: string[] }).pmTips)
}

/** The dock slots as `index:owned|buy|locked`. */
function dockSlots(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    window
      .__pm!.sim.lane.dockSlots()
      .map(
        (d) =>
          `${d.index}:${d.owned ? 'owned' : d.available ? 'buy' : 'locked'}`,
      ),
  )
}

test.describe('M8 docks smoke', () => {
  test('dock 3 shows its unlock tooltip, dock 2 its dialog; Buy is refused at the start balance, then buys dock 2 at L3 with $800', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    test.setTimeout(150_000)
    await pm.open(`${NEW_URL}&view=warehouse&level=3`)
    await pm.freeze()
    await pm.settle(30)
    await recordTooltips(page)
    expect(await dockSlots(page)).toEqual(['1:owned', '2:buy', '3:locked'])

    // Dock 3 (L4): the unlock tooltip, no dialog. M9: L4 is reachable (cap
    // 5), so no `coming soon`; level and price come from economy.docks.
    await tapRoomRect(page, pm, dockHit(3))
    await pm.settle(16)
    expect(
      await sceneTarget(page, 'Warehouse', 'wh:dockDialog:confirm'),
    ).toBeNull()
    const dock3 = await page.evaluate(() => {
      const d = window.__pm!.data.economy
      const row = d.docks.find((r) => r.index === 3)!
      return {
        level: row.unlockLevel,
        price: row.price,
        soon: row.unlockLevel > d.playtestMaxLevel,
      }
    })
    expect(dock3.soon, 'L4 is reachable at M9').toBe(false)
    expect(await tooltips(page)).toEqual([
      `Loading dock 3 — unlocks at Lv ${dock3.level} ($${dock3.price.toLocaleString('en-US')})`,
    ])

    // Dock 2 (L3, $800) at the start balance: the dialog, Buy refused.
    const money0 = await page.evaluate(() => window.__pm!.sim.money)
    expect(money0).toBeLessThan(800)
    await tapRoomRect(page, pm, dockHit(2))
    await pm.settle(16)
    await tapTarget(page, pm, 'Warehouse', 'wh:dockDialog:confirm')
    await pm.settle(16)
    const refused = await page.evaluate(() => ({
      money: window.__pm!.sim.money,
      buys: window
        .__pm!.core.commandLog.filter((e) => e.cmd.kind === 'buyDock')
        .map((e) => e.cmd),
    }))
    const tips = await tooltips(page)
    console.log(
      `smoke: dock 2 at $${money0} ${JSON.stringify({ refused, tips })}`,
    )
    expect(refused).toEqual({ money: money0, buys: [] })
    expect(await dockSlots(page)).toEqual(['1:owned', '2:buy', '3:locked'])
    expect(tips[1]).toBe('Not enough money')
    expect(
      await sceneTarget(page, 'Warehouse', 'wh:dockDialog:confirm'),
      'the dialog closed',
    ).toBeNull()

    // level-up-3.json without the policy: sim-only to L3 with $800 (build 3:
    // answering any card a draw opens on the way — a held sim stays put).
    const fx = readFileSync(LEVEL_UP_3_FIXTURE, 'utf8')
    expect(
      (JSON.parse(fx) as { dataHash: string }).dataHash,
      `${LEVEL_UP_3_FIXTURE} is stale: run \`node tools/fixtures/m8.ts\``,
    ).toBe(await page.evaluate(() => window.__pm!.data.hash))
    const ready = await page.evaluate((json) => {
      const api = window.__pm!
      api.load(json)
      let ms = 0
      while (!(api.sim.level >= 3 && api.sim.money >= 800) && ms < 180_000) {
        api.advance(100, true)
        ms += 100
      }
      return { ms, level: api.sim.level, money: api.sim.money }
    }, fx)
    console.log(`smoke: level-up-3 to $800 at L3 ${JSON.stringify(ready)}`)
    expect(ready.level).toBe(3)
    expect(ready.money).toBeGreaterThanOrEqual(800)
    await pm.settle(30)
    expect(await dockSlots(page)).toEqual(['1:owned', '2:buy', '3:locked'])
    await tapRoomRect(page, pm, dockHit(2))
    await pm.settle(16)
    await tapTarget(page, pm, 'Warehouse', 'wh:dockDialog:confirm')
    await pm.settle(8)
    const after = await page.evaluate(() => {
      const api = window.__pm!
      const log = api.core.commandLog
      return {
        money: api.sim.money,
        docks: api.core.state.lane.docks.map((d) => d.id),
        last: log[log.length - 1]?.cmd ?? null,
      }
    })
    console.log(`smoke: dock 2 bought ${JSON.stringify(after)}`)
    expect(after.money).toBe(ready.money - 800)
    expect(after.docks).toEqual(['dock1', 'dock2'])
    expect(after.last).toEqual({ kind: 'buyDock', index: 2 })
    expect(await dockSlots(page)).toEqual(['1:owned', '2:owned', '3:locked'])
    // Build 3 (M11): the regenerated level-up-3 run can leave the first-flag
    // hint toast up in the lane; the dock toast queues behind it.
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await toastText(page)).startsWith('Loading dock 2 open'),
        600,
      ),
      'the dock toast',
    ).toBe(true)
    expect(await toastText(page)).toBe(
      'Loading dock 2 open — two vehicles unload at once',
    )
    expect(await page.evaluate(() => window.__pm!.replay().matches)).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

/**
 * A real one-finger drag (CDP touch events, as a phone sends them) from
 * logical game px `from` to `to` in `steps` moves, one 16-ms frame after
 * each event (well inside the 450-ms lift).
 */
async function touchDrag(
  page: Page,
  pm: PmHelpers,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
): Promise<void> {
  const css = await page.evaluate(() => {
    const game = window.__pm!.game
    const r = game.canvas.getBoundingClientRect()
    return { left: r.left, top: r.top, zoom: game.scale.zoom }
  })
  const at = (x: number, y: number): { x: number; y: number } => ({
    x: css.left + (x + 0.5) * css.zoom,
    y: css.top + (y + 0.5) * css.zoom,
  })
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [at(from.x, from.y)],
    })
    await pm.settle(1)
    for (let i = 1; i <= steps; i++) {
      const k = i / steps
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          at(
            Math.round(from.x + (to.x - from.x) * k),
            Math.round(from.y + (to.y - from.y) * k),
          ),
        ],
      })
      await pm.settle(1)
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await pm.settle(1)
  } finally {
    await cdp.detach()
  }
}

test.describe('M9 room scroll smoke', () => {
  test('a fresh ?level=5 game in the room: 18 rows that scroll (readout fixed), a touch drag scrolls 1:1 and opens nothing, a tap on slot 6 still lands on slot 6', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(`${NEW_URL}&view=warehouse&level=5`)
    await pm.freeze()
    await pm.settle(30)
    const f0 = await roomFit(page)
    expect(f0.tier).toBe(5)
    expect(f0.roomH, '18 rows').toBe(18 * 32)
    expectRoomScrolls(f0, 'L5 at 393×659')
    expect(f0.maxScroll, 'design §6.1: 73 at 393×659').toBe(73)
    expect(f0.scrollY).toBe(0)

    // A drag 40 px up from the viewport's middle (over the belt and rack).
    const x = f0.roomX + 160
    const y = f0.viewport.y + Math.floor(f0.viewport.h / 2)
    await touchDrag(page, pm, { x, y }, { x, y: y - 40 })
    await pm.settle(8)
    const f1 = await roomFit(page)
    console.log(`smoke: drag-scroll ${JSON.stringify({ f0, f1 })}`)
    expectRoomScrolls(f1, 'after the drag')
    expect(f1.scrollY, '1:1, no inertia').toBe(40)
    expect(f1.readout, 'the readout does not move').toEqual(f0.readout)
    expect(await openSheet(page), 'a drag is never a tap').toBeNull()

    // Scrolled, slot 6 (an empty live slot at a fresh L5) opens its BuySheet.
    const slot6 = layoutFor(5).rectFor('slot6')!
    expect(slot6.y + slot6.h - f1.scrollY).toBeLessThanOrEqual(f1.viewport.h)
    await tapRoomRect(page, pm, slot6)
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'buy',
      ),
      'slot 6 opens the BuySheet',
    ).toBe(true)
    const f2 = await roomFit(page)
    const sheetTop = await page.evaluate(() => {
      const wh = window.__pm!.game.scene.getScene('Warehouse') as unknown as {
        buy: { top: number } | null
      }
      return wh.buy?.top ?? null
    })
    console.log(`smoke: slot 6 sheet ${JSON.stringify({ f2, sheetTop })}`)
    expectRoomScrolls(f2, 'with the sheet')
    expect(sheetTop, 'the BuySheet top').not.toBeNull()
    // Scroll-into-view (design §6.1): the room scrolls toward slot 6 as far
    // as it goes — at 393×659 the BuySheet (top ≈ 219) still covers slot 6
    // at maxScroll, so only the clamp is pinned here.
    expect(f2.scrollY, 'scrolled toward slot 6, clamped').toBe(f2.maxScroll)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('a drag or a lift released over a HUD band (its zone takes the pointer-up) leaves no stale press: the ghost snaps back, the next tap is a tap', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(`${NEW_URL}&view=warehouse&level=5`)
    await pm.freeze()
    await pm.settle(30)
    const f0 = await roomFit(page)
    expectRoomScrolls(f0, 'L5 at 393×659')
    const press = (): Promise<{
      press: boolean
      drag: boolean
      slot1: string | null
    }> =>
      page.evaluate(() => {
        const api = window.__pm!
        const wh = api.game.scene.getScene('Warehouse') as unknown as {
          press: object | null
          drag: object | null
        }
        const n = api.core.state.lane.nodes.find((x) => x.id === 'slot1')
        return {
          press: wh.press !== null,
          drag: wh.drag !== null,
          slot1: n?.fixture?.kind ?? null,
        }
      })
    const x = f0.roomX + 160
    const mid = f0.viewport.y + Math.floor(f0.viewport.h / 2)

    // 1. A scroll drag that ends on the bottom bar.
    await touchDrag(page, pm, { x, y: mid }, { x, y: f0.bandBottom + 24 }, 10)
    await pm.settle(2)
    expect(await press(), 'no press left after the drag').toMatchObject({
      press: false,
      drag: false,
    })
    // The next tap on slot 2 (empty at a fresh L5) opens its BuySheet.
    await tapRoomRect(page, pm, layoutFor(5).rectFor('slot2')!)
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'buy',
      ),
      'the tap after the drag opens slot 2',
    ).toBe(true)
    await page.keyboard.press('Escape')
    await pm.settle(20)
    expect(await openSheet(page)).toBeNull()

    // 2. A lift (hold ≥ 450 ms on slot 1's desk) released on the top band.
    await roomScrollTo(page, 0)
    const f1 = await roomFit(page)
    const s1 = layoutFor(5).rectFor('slot1')!
    const from = {
      x: f1.roomX + s1.x + Math.floor(s1.w / 2),
      y: f1.roomY + s1.y + Math.floor(s1.h / 2),
    }
    expect((await press()).slot1, 'slot 1 holds the start desk').toBe('desk')
    const css = await page.evaluate(() => {
      const game = window.__pm!.game
      const r = game.canvas.getBoundingClientRect()
      return { left: r.left, top: r.top, zoom: game.scale.zoom }
    })
    const at = (px: number, py: number): { x: number; y: number } => ({
      x: css.left + (px + 0.5) * css.zoom,
      y: css.top + (py + 0.5) * css.zoom,
    })
    const cdp = await page.context().newCDPSession(page)
    try {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [at(from.x, from.y)],
      })
      await pm.settle(32) // > HOLD_MS on the frozen 16-ms frames
      expect((await press()).drag, 'lifted').toBe(true)
      for (const y of [from.y - 40, 60, 40, 30]) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [at(from.x, y)],
        })
        await pm.settle(1)
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      })
    } finally {
      await cdp.detach()
    }
    await pm.settle(20) // the 150-ms snap back
    expect(await press(), 'the ghost snapped back').toEqual({
      press: false,
      drag: false,
      slot1: 'desk',
    })
    // The next tap on empty slot 6 is a tap (its BuySheet), not a drop.
    const slot6 = layoutFor(5).rectFor('slot6')!
    await roomScrollTo(page, f1.maxScroll)
    await tapRoomRect(page, pm, slot6)
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'buy',
      ),
      'slot 6 opens its BuySheet',
    ).toBe(true)
    expect((await press()).slot1, 'the desk stayed in slot 1').toBe('desk')
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('a level-up 3 → 4 inside the room in real time (R21 fade): the old room fades out on the new room’s origin, is gone after the tier fade, and the HUD toast lane follows the taller room', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(`${NEW_URL}&view=warehouse&level=3`)
    await pm.thaw()
    await page.waitForTimeout(600)
    const f0 = await roomFit(page)
    expect(f0.tier).toBe(3)
    expect(f0.fits).toBe(true)
    const ok = await page.evaluate(
      () => window.__pm!.dispatch({ kind: 'debugForceLevel', level: 4 }).ok,
    )
    expect(ok).toBe(true)
    const mid = await (
      await page.waitForFunction(
        () => {
          const wh = window.__pm!.game.scene.getScene(
            'Warehouse',
          ) as unknown as {
            fading: { x: number; y: number; alpha: number }[]
            layers: { root: { x: number; y: number } }
          }
          const old = wh.fading[0]
          if (!old) return null
          return {
            old: { x: old.x, y: old.y, alpha: old.alpha },
            root: { x: wh.layers.root.x, y: wh.layers.root.y },
          }
        },
        null,
        { timeout: 3000 },
      )
    ).jsonValue()
    console.log(`smoke: R21 fade ${JSON.stringify(mid)}`)
    expect(mid, 'a fading old room').not.toBeNull()
    expect(mid!.old.alpha).toBeGreaterThan(0)
    expect(
      { x: mid!.old.x, y: mid!.old.y },
      'the old room fades on the new room’s origin',
    ).toEqual(mid!.root)
    await page.waitForFunction(
      () =>
        (
          window.__pm!.game.scene.getScene('Warehouse') as unknown as {
            fading: unknown[]
          }
        ).fading.length === 0,
      null,
      { timeout: 3000 },
    )
    await pm.freeze()
    const f1 = await roomFit(page)
    expect(f1.tier).toBe(4)
    expectRoomScrolls(f1, 'L4 at 393×659')
    const lane = await page.evaluate(() => {
      const wh = window.__pm!.game.scene.getScene('Warehouse') as unknown as {
        roomTop: number
      }
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        toast: { laneY: number }
      }
      return { toast: hud.toast.laneY, roomTop: wh.roomTop }
    })
    console.log(`smoke: toast lane after 3 → 4 ${JSON.stringify(lane)}`)
    expect(lane.toast, 'the toast lane on the new room’s north wall').toBe(
      lane.roomTop + 4,
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})
