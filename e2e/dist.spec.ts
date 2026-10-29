// The playtest build as served (plan.md §12.7 task 3 + acceptance, §6.12): the
// `dist` project runs this against `vite preview` of dist/ (the production
// bundle: import.meta.env.DEV is false), on the iPhone 16 profile.
//   1. `/` — no debug surface: the Title appears (its New game button matches
//      the pixels a ?debug=1 probe of the same layout captured),
//      window.__pm is absent before and after a real New game tap, and the
//      game it starts autosaves pm.save.v1 on pagehide; no console error.
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
import { readFileSync } from 'node:fs'
import type { CDPSession, Page } from '@playwright/test'
import sharp from 'sharp'
import { expect, READY_TIMEOUT_MS, test } from './fixtures.ts'
import { sceneTarget, tapTarget } from './warehouse.ts'

const NEW_GAME = 'title:new-game'
const SAVE_KEY = 'pm.save.v1'
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
  // Two frames apart: the button is static, and it is a button (face,
  // outline, bevel, label), not a flat patch of the sky.
  const rgba = await clipRgba(page, rect)
  await page.waitForTimeout(250)
  expect(sameFraction(rgba, await clipRgba(page, rect))).toBe(1)
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
    // HUD's autosave writes pm.save.v1 at once (src/boot/autosave.ts).
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
        { timeout: 15_000, message: 'pm.save.v1 after New game' },
      )
      .toBe(1)
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
        stamp: String(api.game.registry.get('buildStamp') ?? ''),
      }
    })
    expect(got.baseShare).toBe(spicy.parcels.malware.baseShare)
    expect(got.decoyShare).toBe(spicy.parcels.decoyShare)
    expect(got.holdBayCaps.slice(0, spicy.levels.length)).toEqual(
      spicy.levels.map((l) => l.holdBayCap),
    )
    expect(got.stamp.endsWith(' cfg:spicy')).toBe(true)
    expect(configs.urls).toHaveLength(1)

    // Without ?debug=1 the override is ignored: Boot loads the data (and any
    // config) before Preload requests the atlas, so once world.png answers
    // the decision is made.
    configs.urls.length = 0
    const atlas = page.waitForResponse((r) =>
      r.url().endsWith('/assets/world.png'),
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
})
