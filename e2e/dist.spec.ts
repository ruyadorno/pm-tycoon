// The playtest build as served (plan.md §12.7 task 3 + acceptance, §6.12): the
// `dist` project runs this against `vite preview` of dist/ (the production
// bundle: import.meta.env.DEV is false), on the iPhone 16 profile.
//   1. `/` — no debug surface: the Title appears (its New game button matches
//      the pixels a ?debug=1 probe of the same layout captured; the attract
//      city moves behind it, so "the same" allows SAME_PIXELS_MIN),
//      window.__pm is absent before and after a real New game tap, and the
//      game it starts autosaves pm.save.v2 (version 6 since M11) on pagehide; no
//      console error.
//   2. `/?debug=1` — window.__pm is present on the production build, the
//      Title is the active scene, New game → __pm.ready (City); no console
//      error.
//   3. `?config=` is a debug-only override: with ?debug=1, ?config=spicy
//      fetches configs/spicy.json from dist/ and the booted data carries its
//      values (+ the build stamp's ` cfg:spicy`); without ?debug=1 nothing
//      is fetched from configs/. Under ?audio=0 no sample is fetched.
//   4. Samples (audio.md §8.2): every audio/sf/ request is page-relative
//      (works under /pm-tycoon/ on Pages) and answered 200 (or 304), nothing
//      sounds before the Title tap (the director is not unlocked, no note),
//      the tap starts the band, no CacheStorage and no service worker, and a
//      reload re-uses the HTTP cache (every sample revalidated 304 or served
//      from the disk/memory cache — vite preview sends `Cache-Control:
//      no-cache` + ETag). The number of samples requested before the tap is
//      logged: Preload starts the fetch while the Title waits (audio.md §3.2).
//   5. Hashed assets (report-playtest1 §6.21, spec-build2 §6.8): the `world`
//      and `interior` atlases, the m5x7 XML, the logo and the attract
//      snapshot are fetched once each under content-hashed names
//      (assets/<stem>-<hash>.<ext>, answered 200), never from the unhashed
//      playtest-1 paths; both atlases are textures, the logo a texture and
//      the snapshot in the JSON cache. Draw calls (plan-build2 §6 / §8.2 task
//      8, iPhone profile = one texture per batch): City + HUD ≤ 3, Warehouse
//      + HUD ≤ 7 after 60 s of the policy, and ≤ 7 again at tier 5 scrolled
//      (M9 review: the cover over the bands batches with the readout).
import { readFileSync } from 'node:fs'
import type { CDPSession, Page } from '@playwright/test'
import sharp from 'sharp'
import { expect, questUi, READY_TIMEOUT_MS, test } from './fixtures.ts'
import { sceneTarget, settleUntil, tapTarget, worlds } from './warehouse.ts'

const NEW_GAME = 'title:new-game'
const SAVE_KEY = 'pm.save.v2'
/** src/sim/save.ts SAVE_VERSION = types.ts STATE_VERSION (6 since M11, M11 contract §2.2). */
const SAVE_VERSION = 6
/** plan-build2 §6 "Draw-call budget": city 3 (measured), warehouse 7. */
const CITY_DRAW_CALLS = 3
const WAREHOUSE_DRAW_CALLS = 7
const POLICY_URL = '/?seed=7&debug=1&skipTitle=1&audio=0&policy=1'
/** The tycoon recipe on Boot's fresh game (L5, the full lane, docks 2–3, 8 vehicles). */
const TYCOON_URL =
  '/?seed=7&debug=1&skipTitle=1&audio=0&config=tycoon&newGame=1'
/** dist/assets/<stem>-<hash>.<ext> for every `?url` import of src/render/assetUrls.ts. */
const HASHED_ASSETS = [
  'world.png',
  'world.json',
  'interior.png',
  'interior.json',
  'm5x7.xml',
  'logo.png',
  'attract.json',
] as const

/** `world.png` -> /assets/world-<hash>.png */
function hashedRe(asset: string): RegExp {
  const dot = asset.lastIndexOf('.')
  const stem = asset.slice(0, dot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`/assets/${stem}-[\\w-]{6,}\\${asset.slice(dot)}$`)
}
const SPICY_PATH = 'public/configs/spicy.json'
/** Share of identical pixels for "the New game button is on screen". */
const SAME_PIXELS_MIN = 0.97

interface CssRect {
  x: number
  y: number
  width: number
  height: number
}

interface TitleProbe {
  /** The New game button's hit rect in CSS px (page coordinates). */
  rect: CssRect
  /** Its pixels (RGBA, CSS scale) on the ?debug=1 Title. */
  rgba: Buffer
}

async function titleUp(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.__pm?.game.scene.isActive('Title') === true,
    null,
    { timeout: READY_TIMEOUT_MS },
  )
}

async function clipRgba(page: Page, rect: CssRect): Promise<Buffer> {
  const png = await page.screenshot({ clip: rect, scale: 'css' })
  return sharp(png).ensureAlpha().raw().toBuffer()
}

function sameFraction(a: Buffer, b: Buffer): number {
  if (a.length !== b.length || a.length === 0) return 0
  let same = 0
  for (let i = 0; i < a.length; i += 4) {
    if (
      a[i] === b[i] &&
      a[i + 1] === b[i + 1] &&
      a[i + 2] === b[i + 2] &&
      a[i + 3] === b[i + 3]
    ) {
      same++
    }
  }
  return same / (a.length / 4)
}

function distinctColours(rgba: Buffer): number {
  const seen = new Set<number>()
  for (let i = 0; i < rgba.length; i += 4) seen.add(rgba.readUInt32BE(i))
  return seen.size
}

/**
 * Where the Title's New game button is and what it looks like, read through
 * __pm on a ?debug=1 load of the same build and viewport (the layout does not
 * depend on the debug flag, and a fresh origin has no save, so the column is
 * New game / Reset / Credits).
 */
async function probeTitle(page: Page): Promise<TitleProbe> {
  await page.goto('/?debug=1')
  await titleUp(page)
  await expect
    .poll(() => sceneTarget(page, 'Title', NEW_GAME), { timeout: 15_000 })
    .not.toBeNull()
  const r = (await sceneTarget(page, 'Title', NEW_GAME))!
  const rect = await page.evaluate(
    ([lx, ly, lw, lh]) => {
      const game = window.__pm!.game
      const c = game.canvas.getBoundingClientRect()
      const z = game.scale.zoom
      return {
        x: Math.round(c.left + lx! * z),
        y: Math.round(c.top + ly! * z),
        width: Math.round(lw! * z),
        height: Math.round(lh! * z),
      }
    },
    [r.x, r.y, r.w, r.h] as const,
  )
  // Two frames apart: the button is static (the attract city drifting
  // behind may only show through its rounded corners), and it is a button
  // (face, outline, bevel, label), not a flat patch of the sky.
  const rgba = await clipRgba(page, rect)
  await page.waitForTimeout(250)
  expect(sameFraction(rgba, await clipRgba(page, rect))).toBeGreaterThanOrEqual(
    SAME_PIXELS_MIN,
  )
  expect(distinctColours(rgba)).toBeGreaterThanOrEqual(3)
  await page.evaluate(() => localStorage.clear())
  return { rect, rgba }
}

/** Counts requests whose URL path contains `part` (from now on). */
function countRequests(page: Page, part: string): { urls: string[] } {
  const seen = { urls: [] as string[] }
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.includes(part)) seen.urls.push(req.url())
  })
  return seen
}

test.describe('dist build (vite preview of dist/)', () => {
  test('/: the Title appears, window.__pm is absent, New game starts a saved game', async ({
    page,
    consoleErrors,
  }) => {
    const probe = await probeTitle(page)
    consoleErrors.length = 0

    await page.goto('/')
    await expect(page.locator('#game canvas')).toHaveCount(1)
    await expect
      .poll(
        async () => sameFraction(probe.rgba, await clipRgba(page, probe.rect)),
        { timeout: READY_TIMEOUT_MS, message: 'the Title New game button' },
      )
      .toBeGreaterThanOrEqual(SAME_PIXELS_MIN)
    await expect(page.locator('.pm-card')).toHaveCount(0)
    expect(await page.evaluate(() => typeof window.__pm)).toBe('undefined')

    // A real tap on New game (also the audio unlock), then a pagehide: the
    // HUD's autosave writes pm.save.v2 at once (src/boot/autosave.ts).
    await page.touchscreen.tap(
      probe.rect.x + Math.floor(probe.rect.width / 2),
      probe.rect.y + Math.floor(probe.rect.height / 2),
    )
    await page.waitForTimeout(1500)
    await expect
      .poll(
        () =>
          page.evaluate((key) => {
            window.dispatchEvent(new PageTransitionEvent('pagehide'))
            const raw = localStorage.getItem(key)
            return raw
              ? (JSON.parse(raw) as { version?: number }).version
              : null
          }, SAVE_KEY),
        { timeout: 15_000, message: `${SAVE_KEY} after New game` },
      )
      .toBe(SAVE_VERSION)
    expect(await page.evaluate(() => typeof window.__pm)).toBe('undefined')
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('/?debug=1: window.__pm is present on the production build; Title → New game → City', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await page.goto('/?debug=1&seed=7')
    await titleUp(page)
    const info = await page.evaluate(() => {
      const api = window.__pm!
      return {
        debug: api.params.debug,
        seed: api.seed,
        ready: api.ready,
        stamp: String(api.game.registry.get('buildStamp') ?? ''),
      }
    })
    expect(info.debug).toBe(true)
    expect(info.seed).toBe(7)
    expect(info.ready).toBe(false) // flips with the City's CREATE
    expect(info.stamp).toMatch(/^\S+ \d{4}-\d{2}-\d{2}$/)
    await tapTarget(page, pm, 'Title', NEW_GAME)
    await pm.ready()
    expect(
      await page.evaluate(() => window.__pm!.game.scene.isActive('City')),
    ).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('?config=spicy: fetched from dist/configs/ with ?debug=1, ignored without it; ?audio=0 fetches no sample', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    const spicy = JSON.parse(readFileSync(SPICY_PATH, 'utf8')) as {
      parcels: { malware: { baseShare: number }; decoyShare: number }
      levels: { holdBayCap: number }[]
      events: { schedule: { firstEventS: number } }
    }
    const configs = countRequests(page, '/configs/')
    const samples = countRequests(page, '/audio/sf/')
    const spicyResponse = page.waitForResponse((r) =>
      r.url().endsWith('/configs/spicy.json'),
    )
    await pm.open('/?debug=1&config=spicy&skipTitle=1&audio=0&newGame=1')
    const res = await spicyResponse
    expect(res.status()).toBe(200)
    expect(new URL(res.url()).pathname).toBe('/configs/spicy.json')
    const got = await page.evaluate(() => {
      const api = window.__pm!
      return {
        baseShare: api.data.parcels.malware.baseShare,
        decoyShare: api.data.parcels.decoyShare,
        holdBayCaps: api.data.levels.map((l) => l.holdBayCap),
        firstEventS: api.data.events.schedule.firstEventS,
        stamp: String(api.game.registry.get('buildStamp') ?? ''),
      }
    })
    expect(got.baseShare).toBe(spicy.parcels.malware.baseShare)
    // Build 3 (B3 §7): spicy's quicker events cadence rides in the same file.
    expect(got.firstEventS).toBe(spicy.events.schedule.firstEventS)
    expect(got.decoyShare).toBe(spicy.parcels.decoyShare)
    expect(got.holdBayCaps.slice(0, spicy.levels.length)).toEqual(
      spicy.levels.map((l) => l.holdBayCap),
    )
    expect(got.stamp.endsWith(' cfg:spicy')).toBe(true)
    expect(configs.urls).toHaveLength(1)

    // Without ?debug=1 the override is ignored: Boot loads the data (and any
    // config) before Preload requests the atlases, so once world-<hash>.png
    // answers the decision is made.
    configs.urls.length = 0
    const atlas = page.waitForResponse((r) =>
      hashedRe('world.png').test(new URL(r.url()).pathname),
    )
    await page.goto('/?config=spicy&audio=0')
    expect((await atlas).status()).toBe(200)
    await page.waitForTimeout(1000)
    expect(configs.urls).toEqual([])
    expect(await page.evaluate(() => typeof window.__pm)).toBe('undefined')
    expect(samples.urls, 'no sample fetch under ?audio=0').toEqual([])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('samples: page-relative, plain HTTP caching, silent until the Title tap', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    // Network.responseReceived reports a revalidated fetch() as the cached
    // 200; the wire status (304) comes with responseReceivedExtraInfo, which
    // may arrive before or after it. Memory-cache hits only show up as
    // requestServedFromCache.
    const cdp: CDPSession = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    type Hit = { url: string; status: number; wire: number; cached: boolean }
    let hits: Hit[] = []
    const byId = new Map<string, Hit>()
    const wire = new Map<string, number>()
    const servedFromCache = new Set<string>()
    cdp.on('Network.responseReceived', (e) => {
      if (!e.response.url.includes('/audio/sf/')) return
      const hit = {
        url: e.response.url,
        status: e.response.status,
        wire: wire.get(e.requestId) ?? e.response.status,
        cached:
          servedFromCache.has(e.requestId) || e.response.fromDiskCache === true,
      }
      byId.set(e.requestId, hit)
      hits.push(hit)
    })
    cdp.on('Network.responseReceivedExtraInfo', (e) => {
      wire.set(e.requestId, e.statusCode)
      const hit = byId.get(e.requestId)
      if (hit) hit.wire = e.statusCode
    })
    cdp.on('Network.requestServedFromCache', (e) => {
      servedFromCache.add(e.requestId)
      const hit = byId.get(e.requestId)
      if (hit) hit.cached = true
    })

    await page.goto('/?debug=1&seed=7')
    await titleUp(page)
    // Let the Preload chain settle (piano + bass, vibes + trumpet, stingers).
    await page.waitForFunction(
      () => {
        const loaded = Object.values(window.__pm!.audio!.state().loaded)
        return loaded.length > 0 && loaded.every(Boolean)
      },
      null,
      { timeout: 30_000 },
    )
    const beforeTap = hits.length
    const pre = await page.evaluate(() => {
      const a = window.__pm!.audio!
      const st = a.state()
      return {
        unlocked: st.unlocked,
        transport: st.transport.state,
        notes: a.log.notes().length,
      }
    })
    expect(pre).toEqual({ unlocked: false, transport: 'stopped', notes: 0 })

    await tapTarget(page, pm, 'Title', NEW_GAME)
    await page.waitForFunction(
      () => window.__pm!.audio!.state().transport.state === 'started',
      null,
      { timeout: 15_000 },
    )
    await page.waitForTimeout(1000)
    const mp3 = hits.filter((h) => h.url.endsWith('.mp3'))
    const presets = hits.filter((h) => h.url.endsWith('.preset.json'))
    console.log(
      `dist: samples requested ${mp3.length} mp3 + ${presets.length} presets, ` +
        `${beforeTap} of ${hits.length} before the Title tap`,
    )
    test.info().annotations.push({
      type: 'samples before the Title tap',
      description: `${beforeTap} of ${hits.length}`,
    })
    expect(mp3.length).toBeGreaterThan(0)
    expect(presets.length).toBe(4)
    for (const h of hits) {
      expect(new URL(h.url).pathname, h.url).toMatch(/^\/audio\/sf\//)
      expect([200, 304], h.url).toContain(h.wire)
    }
    const storage = await page.evaluate(async () => ({
      caches: 'caches' in window ? (await caches.keys()).length : 0,
      sw: !!navigator.serviceWorker?.controller,
    }))
    expect(storage).toEqual({ caches: 0, sw: false })

    // Second load: the same samples come from the HTTP cache (revalidated
    // with a 304 under vite preview's `no-cache`), none is downloaded again.
    hits = []
    await page.reload()
    await titleUp(page)
    await expect
      .poll(() => hits.filter((h) => h.url.endsWith('.mp3')).length, {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(mp3.length)
    await page.waitForTimeout(250) // trailing ExtraInfo events
    const refetched = hits.filter((h) => h.wire === 200 && !h.cached)
    expect(refetched.map((h) => h.url)).toEqual([])
    const revalidated = hits.filter((h) => h.wire === 304).length
    console.log(
      `dist: reload — ${revalidated} samples revalidated (304), ` +
        `${hits.filter((h) => h.cached).length} from the cache`,
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('hashed assets: both atlases, the font XML, logo and attract snapshot; draw calls city ≤ 3, warehouse ≤ 7', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    const seen: { path: string; status: number }[] = []
    page.on('response', (r) => {
      const path = new URL(r.url()).pathname
      if (path.startsWith('/assets/') && !path.endsWith('.js')) {
        seen.push({ path, status: r.status() })
      }
    })
    await pm.open(POLICY_URL)
    for (const asset of HASHED_ASSETS) {
      const re = hashedRe(asset)
      const hits = seen.filter((h) => re.test(h.path))
      expect(hits.length, `one fetch of ${asset} under a hashed name`).toBe(1)
      expect([200, 304], hits[0]!.path).toContain(hits[0]!.status)
    }
    const unhashed = seen.filter((h) =>
      HASHED_ASSETS.some((a) => h.path.endsWith(`/assets/${a}`)),
    )
    expect(unhashed.map((h) => h.path)).toEqual([])
    const loaded = await page.evaluate(() => {
      const game = window.__pm!.game
      const frames = (k: string): number =>
        game.textures.exists(k)
          ? game.textures.get(k).getFrameNames().length
          : 0
      return {
        world: frames('world'),
        interior: frames('interior'),
        logo: game.textures.exists('logo'),
        attract: game.cache.json.exists('attract'),
        font: game.cache.bitmapFont.has('m5x7'),
      }
    })
    console.log(`dist: textures ${JSON.stringify(loaded)}`)
    expect(loaded.world).toBeGreaterThan(100)
    expect(loaded.interior).toBeGreaterThan(50)
    expect(loaded).toMatchObject({ logo: true, attract: true, font: true })

    // Draw calls with the overlay hidden: the City at t = 0, then the
    // Warehouse after 60 s of the policy (parcels, workers, the Hold Bay).
    await pm.freeze()
    await pm.overlay(false)
    await pm.settle(4)
    const city = await page.evaluate(() => window.__pm!.metrics().drawCalls)
    await pm.advance(60_000)
    await page.evaluate(() => window.__pm!.goto('warehouse'))
    const ok = await settleUntil(
      page,
      pm,
      async () => (await worlds(page)).warehouse === 'active',
    )
    expect(ok, 'the Warehouse is active').toBe(true)
    await pm.settle(24)
    const warehouse = await page.evaluate(
      () => window.__pm!.metrics().drawCalls,
    )
    console.log(`dist: draw calls city ${city}, warehouse ${warehouse}`)
    test.info().annotations.push({
      type: 'draw calls',
      description: `city ${city}, warehouse ${warehouse}`,
    })
    expect(city, 'City + HUD draw calls').toBeLessThanOrEqual(CITY_DRAW_CALLS)
    expect(warehouse, 'Warehouse + HUD draw calls').toBeLessThanOrEqual(
      WAREHOUSE_DRAW_CALLS,
    )

    // M9 review: tier 5 on this phone scrolls, so the cover over the bands
    // is up — it must batch with the readout and the HUD (≤ 7 still).
    expect(
      await page.evaluate(
        () => window.__pm!.dispatch({ kind: 'debugForceLevel', level: 5 }).ok,
      ),
    ).toBe(true)
    await pm.settle(24)
    const t5 = await page.evaluate(() => {
      const wh = window.__pm!.game.scene.getScene('Warehouse') as unknown as {
        stats(): { tier: number; maxScroll: number }
        scrollTo(y: number): number
      }
      wh.scrollTo(30)
      return wh.stats()
    })
    expect(t5.tier).toBe(5)
    expect(t5.maxScroll, 'tier 5 scrolls at 393×659').toBeGreaterThan(0)
    await pm.settle(4)
    const warehouse5 = await page.evaluate(
      () => window.__pm!.metrics().drawCalls,
    )
    console.log(`dist: draw calls warehouse tier 5 (scrolled) ${warehouse5}`)
    test.info().annotations.push({
      type: 'draw calls tier 5',
      description: `warehouse ${warehouse5}`,
    })
    expect(
      warehouse5,
      'Warehouse tier 5 (cover up) + HUD draw calls',
    ).toBeLessThanOrEqual(WAREHOUSE_DRAW_CALLS)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('tier 5 with a full lane (?config=tycoon: six slots, two desks of two, the Sorter Arm, three docks): warehouse ≤ 7 draw calls, scrolled and not', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await page.goto(TYCOON_URL)
    await page.evaluate(() => localStorage.clear())
    await pm.open(TYCOON_URL)
    await pm.freeze()
    await pm.overlay(false)
    const lane = await page.evaluate(() => {
      const s = window.__pm!.core.state
      return {
        level: s.level.level,
        fixtures: s.lane.nodes.filter((n) => n.fixture).length,
        docks: s.lane.docks.length,
      }
    })
    expect(lane).toMatchObject({ level: 5, docks: 3 })
    expect(lane.fixtures).toBeGreaterThanOrEqual(6)
    // The Golden Release is offered on the first tick and its card opens (a
    // card draws through a camera of its own): Accept it on the card, as a
    // player does, so the count is the room's and the HUD's alone.
    await pm.advance(200)
    expect(
      await settleUntil(page, pm, async () => (await questUi(page)).card.open),
      'the Golden Release card opens',
    ).toBe(true)
    await pm.settle(30) // the card's pop-in lands before the tap
    await tapTarget(page, pm, 'HUD', 'quest:accept')
    expect(
      await settleUntil(page, pm, async () => {
        const ui = await questUi(page)
        return !ui.card.open && ui.active !== null
      }),
      'accepted: the card closes, the quest is active',
    ).toBe(true)
    await pm.advance(30_000)
    await page.evaluate(() => window.__pm!.goto('warehouse'))
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await worlds(page)).warehouse === 'active',
      ),
      'the Warehouse is active',
    ).toBe(true)
    await pm.settle(24)
    const ui = await questUi(page)
    expect(ui.card.open, 'no quest card over the room').toBe(false)
    expect(ui.modalDepth, 'nothing modal').toBe(0)
    const top = await page.evaluate(() => window.__pm!.metrics().drawCalls)
    const t5 = await page.evaluate(() => {
      const wh = window.__pm!.game.scene.getScene('Warehouse') as unknown as {
        stats(): { tier: number; maxScroll: number }
        scrollTo(y: number): number
      }
      wh.scrollTo(wh.stats().maxScroll)
      return wh.stats()
    })
    await pm.settle(4)
    const scrolled = await page.evaluate(() => window.__pm!.metrics().drawCalls)
    console.log(
      `dist: draw calls tier 5 full lane ${JSON.stringify({ lane, tier: t5.tier, maxScroll: t5.maxScroll, top, scrolled })}`,
    )
    test.info().annotations.push({
      type: 'draw calls tier 5 full lane',
      description: `top ${top}, scrolled ${scrolled}`,
    })
    expect(t5.tier).toBe(5)
    expect(top, 'full tier 5 + HUD draw calls').toBeLessThanOrEqual(
      WAREHOUSE_DRAW_CALLS,
    )
    expect(scrolled, 'full tier 5 scrolled + HUD').toBeLessThanOrEqual(
      WAREHOUSE_DRAW_CALLS,
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})
