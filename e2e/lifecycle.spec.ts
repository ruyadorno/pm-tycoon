// Lifecycle, leak and gesture checks (plan.md §6.5, §6.7, §12.7 M4 bug hunt;
// phaser4-notes.md §5; city-view.md §10), on the production build at the
// iPhone 16 profile. Every scenario compares a snapshot of the listeners
// (sim.events, game.events, scale, registry, renderer, InputManager, each
// world scene's events / input / keyboard plugins, and DOM listeners on
// window / document / the canvas) and the texture keys before and after,
// and checks the invariants a stuck view would break: no hold left on the
// stepper, an empty modal stack, the City not `transitioning`, one vehicle
// view per sim vehicle, no camera fade running, no console error.
//   - City ↔ Warehouse 50 times with 1–4 frames between switches, and a
//     camera pan request (a chip tap) during the City's exit pan;
//   - the same storms during a level-up (fixture level-up.json), a catch
//     moment (forced flag), the lost-life card (malware-cleared.json) and
//     with the Garage open;
//   - New game after game over, past a region unlock (one-life.json after
//     level-up.json): the restarted City leaves no orphan ground texture;
//   - Continue after a reload in the middle of the level-up moment;
//   - __pm.load of every tests/fixtures/*.json in both views;
//   - landscape ↔ portrait (rotate card) and tab hide/show (Paused card);
//   - gestures with real CDP multi-touch: a HUD tap during a city pan keeps
//     panning, pinch while dragging zooms, long-press then drag opens the
//     district panel without panning, a double-tap follows a vehicle at
//     zoom 2, and a tap where a building hides a vehicle picks the building.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { CDPSession, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { policyOff, sceneTarget, tapTarget } from './warehouse.ts'

const GAME = '/?seed=7&debug=1&skipTitle=1&audio=0&policy=1&newGame=1&mute=1'
const TITLE = '/?seed=7&debug=1&audio=0&policy=1&mute=1'
const FIXTURES = fileURLToPath(new URL('../tests/fixtures/', import.meta.url))
const FIXTURE_NAMES = [
  'late-waiting',
  'holdbay-full',
  'malware-cleared',
  'one-life',
  'level-up',
  'payroll-short',
  'l2-lane',
] as const

/** Count DOM listeners on window / document / the canvas, by type. */
function countDomListeners(): void {
  const counts = new Map<string, number>()
  const bump = (t: EventTarget, type: string, d: number): void => {
    const w =
      t === window
        ? 'window'
        : t === document
          ? 'document'
          : t instanceof HTMLCanvasElement
            ? 'canvas'
            : null
    if (w) counts.set(`${w}:${type}`, (counts.get(`${w}:${type}`) ?? 0) + d)
  }
  const add = EventTarget.prototype.addEventListener
  const remove = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    fn: EventListenerOrEventListenerObject | null,
    opts?: boolean | AddEventListenerOptions,
  ): void {
    bump(this, type, 1)
    add.call(this, type, fn, opts)
  }
  EventTarget.prototype.removeEventListener = function (
    this: EventTarget,
    type: string,
    fn: EventListenerOrEventListenerObject | null,
    opts?: boolean | EventListenerOptions,
  ): void {
    bump(this, type, -1)
    remove.call(this, type, fn, opts)
  }
  ;(window as unknown as { pmDomListeners: () => object }).pmDomListeners =
    () => Object.fromEntries(counts)
}

/** Every listener count the game owns, flattened to `emitter:event` keys. */
function listeners(page: Page): Promise<Record<string, number | string>> {
  return page.evaluate(() => {
    type Em = {
      eventNames(): (string | symbol)[]
      listenerCount(n: string | symbol): number
    }
    const out: Record<string, number | string> = {}
    const em = (prefix: string, e: Em | null | undefined): void => {
      if (!e || typeof e.eventNames !== 'function') return
      for (const n of e.eventNames()) {
        const c = e.listenerCount(n)
        if (c) out[`${prefix}:${String(n)}`] = c
      }
    }
    const api = window.__pm!
    const g = api.game as unknown as {
      events: Em
      scale: Em
      registry: { events: Em }
      renderer: Em
      input: { events: Em }
      textures: { list: Record<string, unknown> }
      scene: {
        getScene(k: string): {
          sys: { settings: { status: number } }
          events: Em
          input: Em & { keyboard: Em | null }
        } | null
      }
    }
    em('sim', api.core.events as unknown as Em)
    em('game', g.events)
    em('scale', g.scale)
    em('registry', g.registry.events)
    em('renderer', g.renderer)
    em('input', g.input.events)
    for (const k of ['City', 'Warehouse', 'HUD', 'Garage']) {
      const s = g.scene.getScene(k)
      const st = s?.sys.settings.status ?? 0
      // RUNNING 5, PAUSED 6, SLEEPING 7
      if (!s || st < 5 || st > 7) {
        out[`scene:${k}`] = 'off'
        continue
      }
      em(`${k}.events`, s.events)
      em(`${k}.input`, s.input)
      em(`${k}.keyboard`, s.input.keyboard)
    }
    const dom = (
      window as unknown as { pmDomListeners?: () => Record<string, number> }
    ).pmDomListeners?.()
    for (const [k, v] of Object.entries(dom ?? {})) if (v) out[`dom:${k}`] = v
    // Texture keys, less camera render targets (random uuid keys) and the
    // Newspaper's photos (`news:<frame>`, made once per picture and kept).
    // A region unlock moves the one ground bake from 'ground' to 'ground_b'
    // (and back): both count as 'ground', so an orphan shows up twice.
    out.textures = Object.keys(g.textures.list)
      .filter((k) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(k))
      .filter((k) => !k.startsWith('news:'))
      .map((k) => (k === 'ground_b' ? 'ground' : k))
      .toSorted()
      .join(',')
    return out
  })
}

interface Invariants {
  holds: string[]
  paused: boolean
  modalDepth: number
  city: 'awake' | 'asleep' | 'off'
  warehouse: 'awake' | 'asleep' | 'off'
  cityTransitioning: boolean | null
  cityFade: boolean | null
  vehicleViews: number | null
  simVehicles: number
  warehouseRootAtRest: boolean | null
}

function invariants(page: Page): Promise<Invariants> {
  return page.evaluate((): Invariants => {
    const api = window.__pm!
    const sm = api.game.scene
    const state = (k: string): Invariants['city'] =>
      sm.isSleeping(k) ? 'asleep' : sm.isActive(k) ? 'awake' : 'off'
    const hud = sm.getScene('HUD') as unknown as {
      holds: Set<string>
      modalDepth(): number
    }
    const city = sm.getScene('City') as unknown as {
      transitioning: boolean
      vehicles: Map<number, unknown>
      cameras: { main: { fadeEffect: { isRunning: boolean } } }
    }
    const wh = sm.getScene('Warehouse') as unknown as {
      layers?: { root: { y: number } }
      roomY: number
      entryTween: unknown
    }
    const cityOn = state('City') !== 'off'
    const whOn = state('Warehouse') !== 'off'
    return {
      holds: [...hud.holds].toSorted(),
      paused: api.stepper.paused,
      modalDepth: hud.modalDepth(),
      city: state('City'),
      warehouse: state('Warehouse'),
      cityTransitioning: cityOn ? city.transitioning : null,
      cityFade: cityOn ? city.cameras.main.fadeEffect.isRunning : null,
      vehicleViews: cityOn ? city.vehicles.size : null,
      simVehicles: api.core.state.vehicles.length,
      warehouseRootAtRest:
        whOn && wh.layers && !wh.entryTween
          ? wh.layers.root.y === wh.roomY
          : null,
    }
  })
}

/** n real animation frames (the game loop runs; nothing is frozen). */
function frames(page: Page, n: number): Promise<void> {
  return page.evaluate(
    (k) =>
      new Promise<void>((done) => {
        let i = 0
        const f = (): void => {
          if (++i >= k) done()
          else requestAnimationFrame(f)
        }
        requestAnimationFrame(f)
      }),
    n,
  )
}

function goto(page: Page, view: 'city' | 'warehouse'): Promise<void> {
  return page.evaluate((v) => window.__pm!.goto(v), view)
}

/** City ↔ Warehouse `n` times with 1–4 frames between the switches. */
async function storm(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await goto(page, 'warehouse')
    await frames(page, 1 + (i % 4))
    await goto(page, 'city')
    await frames(page, 1 + ((i * 3) % 4))
  }
}

/** Let every transition land, then come to rest in the City. */
async function restInCity(page: Page): Promise<void> {
  await frames(page, 30)
  await goto(page, 'city')
  await page.waitForFunction(() => {
    const sm = window.__pm!.game.scene
    const city = sm.getScene('City') as unknown as { transitioning: boolean }
    return sm.isActive('City') && !sm.isSleeping('City') && !city.transitioning
  })
  await frames(page, 20)
}

/** In the City, with the Warehouse and the Garage visited once (asleep). */
async function openGame(page: Page): Promise<void> {
  await page.addInitScript(countDomListeners)
  await page.goto(GAME)
  await page.waitForFunction(() => window.__pm?.ready === true, null, {
    timeout: 45_000,
  })
  await frames(page, 10)
  await goto(page, 'warehouse')
  await frames(page, 20)
  await goto(page, 'city')
  await frames(page, 20)
  await page.keyboard.press('g')
  await frames(page, 30)
  await page.keyboard.press('g')
  await restInCity(page)
}

function fixtureText(name: string): string {
  return readFileSync(`${FIXTURES}${name}.json`, 'utf8')
}

async function loadFixture(page: Page, name: string): Promise<void> {
  const text = fixtureText(name)
  await page.evaluate((json) => window.__pm!.load(json), text)
}

function expectAtRest(inv: Invariants, label: string): void {
  expect(inv.holds, `${label}: no hold left`).toEqual([])
  expect(inv.paused, `${label}: the sim runs`).toBe(false)
  expect(inv.modalDepth, `${label}: modal stack empty`).toBe(0)
  expect(inv.city, `${label}: City awake`).toBe('awake')
  expect(inv.cityTransitioning, `${label}: City accepts input`).toBe(false)
  expect(inv.cityFade, `${label}: no camera fade running`).toBe(false)
  expect(inv.vehicleViews, `${label}: one view per vehicle`).toBe(
    inv.simVehicles,
  )
}

test.describe('lifecycle', () => {
  test('City ↔ Warehouse 50 times returns every listener and hold to baseline', async ({
    page,
    consoleErrors,
  }) => {
    await openGame(page)
    const before = await listeners(page)
    await storm(page, 50)
    await restInCity(page)
    expectAtRest(await invariants(page), 'after 50 switches')
    expect(await listeners(page)).toEqual(before)
    expect(consoleErrors).toEqual([])
  })

  test('a camera pan request during the City exit does not stall the switch', async ({
    page,
    consoleErrors,
  }) => {
    await openGame(page)
    // pm:panTo (a chip, the district panel) two frames into the 200-ms exit
    // pan used to replace the pan and its callback: nav's 2-s timeout then
    // made the switch, with the City ignoring input meanwhile.
    const gameMs = await page.evaluate(async () => {
      const api = window.__pm!
      const g = api.game
      const t0 = g.loop.now
      api.goto('warehouse')
      for (let i = 0; i < 2; i++)
        await new Promise((r) => requestAnimationFrame(r))
      g.events.emit('pm:panTo', { regionId: 'downtown' })
      while (
        !(g.scene.isActive('Warehouse') && !g.scene.isSleeping('Warehouse')) &&
        g.loop.now - t0 < 5000
      )
        await new Promise((r) => requestAnimationFrame(r))
      return g.loop.now - t0
    })
    expect(gameMs, 'switch time in game ms').toBeLessThan(1000)
    await restInCity(page)
    expectAtRest(await invariants(page), 'after the switch')
    expect(consoleErrors).toEqual([])
  })

  test('storms during a level-up, a catch, the lost-life card and the Garage leave nothing behind', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await openGame(page)
    const before = await listeners(page)

    // Level-up moment (level-up.json: level:up {2} 3 s in under the policy).
    await loadFixture(page, 'level-up')
    let level = 1
    for (let i = 0; i < 400 && level < 2; i++) {
      await storm(page, 1)
      level = await page.evaluate(() => window.__pm!.core.state.level.level)
    }
    expect(level, 'level-up.json reaches L2 under the storm').toBe(2)
    // Keep switching through the dust / stamp / unlock crossfade.
    await storm(page, 12)
    await restInCity(page)
    const city = await page.evaluate(() => {
      const c = window.__pm!.game.scene.getScene('City') as unknown as {
        construction: unknown
        levelStamp: unknown
        fades: unknown[]
        warehouse: { frame: { name: string } }
      }
      return {
        level: window.__pm!.core.state.level.level,
        construction: c.construction !== null,
        stamp: c.levelStamp !== null,
        fades: c.fades.length,
        frame: c.warehouse.frame.name,
      }
    })
    expect(city).toEqual({
      level: 2,
      construction: false,
      stamp: false,
      fades: 0,
      frame: 'wh_ext_t2',
    })
    expectAtRest(await invariants(page), 'after the level-up storm')

    // Catch moment: a forced flag in the room, then switch away mid-slide.
    await goto(page, 'warehouse')
    await frames(page, 20)
    await policyOff(page)
    await page.evaluate(() => {
      const api = window.__pm!
      const w = window as unknown as { pmFlagged: boolean }
      w.pmFlagged = false
      const ev = api.core.events as unknown as {
        once(n: string, f: () => void): unknown
      }
      ev.once('parcel:flagged', () => {
        w.pmFlagged = true
      })
      api.sim.debug!.forceFlagNext('metal')
      api.speed(4)
    })
    await page.waitForFunction(
      () => (window as unknown as { pmFlagged: boolean }).pmFlagged,
      null,
      { timeout: 60_000 },
    )
    await page.evaluate(() => window.__pm!.speed(1))
    await storm(page, 10)
    await restInCity(page)
    expectAtRest(await invariants(page), 'after the catch storm')

    // The lost-life card (it holds the sim) with switches under it.
    await loadFixture(page, 'malware-cleared')
    const lost = await page.evaluate(async () => {
      const w = await window.__pm!.waitEvent('life:lost', 60_000)
      return w.ok
    })
    expect(lost, 'malware-cleared.json loses a life').toBe(true)
    await page.waitForFunction(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        lostCard: { isOpen(): boolean }
      }
      return hud.lostCard.isOpen()
    })
    await storm(page, 10)
    await frames(page, 30)
    expect((await invariants(page)).holds).toEqual(['lostLife'])
    await tapTarget(page, pm, 'HUD', 'lostLife:continue')
    await restInCity(page)
    expectAtRest(await invariants(page), 'after the lost-life card')

    // The Garage open over both views.
    await page.keyboard.press('g')
    await frames(page, 20)
    await storm(page, 10)
    await frames(page, 30)
    const garage = await page.evaluate(() => {
      const sm = window.__pm!.game.scene
      const order = sm.getScenes(true).map((s) => s.sys.settings.key)
      return {
        open: sm.isActive('Garage') && !sm.isSleeping('Garage'),
        onTop: order[order.length - 1],
      }
    })
    expect(garage).toEqual({ open: true, onTop: 'Garage' })
    await page.keyboard.press('g')
    await restInCity(page)
    expectAtRest(await invariants(page), 'after the Garage storm')
    expect(await listeners(page)).toEqual(before)
    expect(consoleErrors).toEqual([])
  })

  test('New game after game over, past a region unlock, starts clean', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await openGame(page)
    const before = await listeners(page)
    // A region unlock swaps the ground bake to its second texture.
    await loadFixture(page, 'level-up')
    await page.evaluate(() => window.__pm!.waitEvent('region:unlocked', 60_000))
    await frames(page, 90)
    expect(
      await page.evaluate(() => window.__pm!.game.textures.exists('ground_b')),
      'the unlock crossfade baked the second ground texture',
    ).toBe(true)
    await loadFixture(page, 'one-life')
    const over = await page.evaluate(async () => {
      const w = await window.__pm!.waitEvent('game:over', 60_000)
      return w.ok
    })
    expect(over, 'one-life.json ends the game').toBe(true)
    await page.waitForFunction(() =>
      (
        window.__pm!.game.scene.getScene('HUD') as unknown as {
          overCard: { isOpen(): boolean }
        }
      ).overCard.isOpen(),
    )
    await frames(page, 5) // new interactive objects join the input list next frame
    await tapTarget(page, pm, 'HUD', 'gameOver:newGame')
    await page.waitForFunction(() => window.__pm!.game.scene.isActive('Title'))
    await frames(page, 10)
    await tapTarget(page, pm, 'Title', 'title:new-game')
    await page.waitForFunction(
      () =>
        window.__pm!.game.scene.isActive('City') &&
        window.__pm!.game.scene.isActive('HUD'),
    )
    await frames(page, 10)
    // The same visits as openGame() (the Warehouse / Garage were stopped).
    await goto(page, 'warehouse')
    await frames(page, 20)
    await goto(page, 'city')
    await frames(page, 20)
    await page.keyboard.press('g')
    await frames(page, 30)
    await page.keyboard.press('g')
    await restInCity(page)
    expectAtRest(await invariants(page), 'after New game')
    const after = await listeners(page)
    expect(after.textures, 'no orphan ground texture').toBe(before.textures)
    expect(after).toEqual(before)
    expect(consoleErrors).toEqual([])
  })

  test('Continue after a reload mid level-up shows tier 2 at once', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await page.goto(TITLE)
    await page.evaluate(() => localStorage.clear())
    await page.goto(TITLE)
    await page.waitForFunction(() => window.__pm?.game.scene.isActive('Title'))
    await frames(page, 10)
    await tapTarget(page, pm, 'Title', 'title:new-game')
    await page.waitForFunction(() => window.__pm?.ready === true)
    await loadFixture(page, 'level-up')
    await page.waitForFunction(
      () => window.__pm!.core.state.level.level === 2,
      null,
      { timeout: 30_000 },
    )
    const mid = await page.evaluate(
      () =>
        (
          window.__pm!.game.scene.getScene('City') as unknown as {
            construction: unknown
          }
        ).construction !== null,
    )
    expect(mid, 'reloading during the construction overlay').toBe(true)
    await page.reload()
    await page.waitForFunction(() => window.__pm?.game.scene.isActive('Title'))
    await frames(page, 10)
    await tapTarget(page, pm, 'Title', 'title:continue')
    await page.waitForFunction(() => window.__pm!.game.scene.isActive('City'))
    await frames(page, 30)
    const st = await page.evaluate(() => {
      const c = window.__pm!.game.scene.getScene('City') as unknown as {
        construction: unknown
        levelStamp: unknown
        warehouse: { frame: { name: string } }
      }
      return {
        level: window.__pm!.core.state.level.level,
        frame: c.warehouse.frame.name,
        construction: c.construction !== null,
        stamp: c.levelStamp !== null,
      }
    })
    expect(st).toEqual({
      level: 2,
      frame: 'wh_ext_t2',
      construction: false,
      stamp: false,
    })
    expectAtRest(await invariants(page), 'after Continue')
    expect(consoleErrors).toEqual([])
  })

  test('__pm.load of every fixture in both views keeps the views in step', async ({
    page,
    consoleErrors,
  }) => {
    await openGame(page)
    const before = await listeners(page)
    for (const name of FIXTURE_NAMES) {
      for (const view of ['warehouse', 'city'] as const) {
        await goto(page, view)
        await frames(page, 15)
        await loadFixture(page, name)
        await frames(page, 15)
        const inv = await invariants(page)
        expect(inv.holds, `${name} in ${view}`).toEqual([])
        expect(inv.modalDepth, `${name} in ${view}`).toBe(0)
        if (view === 'city')
          expect(inv.vehicleViews, `${name}: vehicle views`).toBe(
            inv.simVehicles,
          )
      }
    }
    await loadFixture(page, 'late-waiting')
    await restInCity(page)
    expectAtRest(await invariants(page), 'after the fixture loads')
    expect(await listeners(page)).toEqual(before)
    expect(consoleErrors).toEqual([])
  })

  test('landscape ↔ portrait and tab hide/show release their holds', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await openGame(page)
    const before = await listeners(page)
    const vp = page.viewportSize()!
    for (const view of ['city', 'warehouse'] as const) {
      await goto(page, view)
      await frames(page, 20)
      await page.setViewportSize({ width: vp.height, height: vp.width })
      await frames(page, 20)
      expect((await invariants(page)).holds, `${view} landscape`).toEqual([
        'rotate',
      ])
      await page.setViewportSize(vp)
      await frames(page, 20)
      const inv = await invariants(page)
      expect(inv.holds, `${view} portrait`).toEqual([])
      if (view === 'warehouse')
        expect(inv.warehouseRootAtRest, 'room back in place').toBe(true)
    }
    await restInCity(page)
    const visibility = (hidden: boolean): Promise<void> =>
      page.evaluate((h) => {
        Object.defineProperty(document, 'hidden', {
          value: h,
          configurable: true,
        })
        Object.defineProperty(document, 'visibilityState', {
          value: h ? 'hidden' : 'visible',
          configurable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      }, hidden)
    for (let i = 0; i < 3; i++) {
      await visibility(true)
      await frames(page, 2)
      await visibility(false)
      await frames(page, 5)
    }
    const paused = await page.evaluate(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        paused: { isOpen(): boolean }
        holds: Set<string>
      }
      return { card: hud.paused.isOpen(), holds: [...hud.holds] }
    })
    expect(paused).toEqual({ card: true, holds: ['hidden'] })
    const W = await page.evaluate(() => window.__pm!.game.scale.width)
    await pm.tap(Math.round(W / 2), 120)
    await frames(page, 10)
    expectAtRest(await invariants(page), 'after resume')
    expect(await listeners(page)).toEqual(before)
    expect(consoleErrors).toEqual([])
  })
})

// ---- gestures (real multi-touch through CDP) --------------------------------

/** Close the onboarding tour (its cards would take the taps). */
function skipTour(page: Page): Promise<void> {
  return page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      onboarding: { skipTour(): void }
    }
    hud.onboarding.skipTour()
  })
}

interface Pt {
  x: number
  y: number
}

/** CSS px of a logical game point. */
async function css(page: Page, x: number, y: number): Promise<Pt> {
  return page.evaluate(
    ([lx, ly]) => {
      const g = window.__pm!.game
      const r = g.canvas.getBoundingClientRect()
      return { x: r.left + lx! * g.scale.zoom, y: r.top + ly! * g.scale.zoom }
    },
    [x, y] as const,
  )
}

/** Screen (logical game px) of a City world point. */
function screenOf(page: Page, wx: number, wy: number): Promise<Pt> {
  return page.evaluate(
    ([x, y]) => {
      const cam = (
        window.__pm!.game.scene.getScene('City') as unknown as {
          cameras: {
            main: {
              worldView: { x: number; y: number }
              zoom: number
              x: number
              y: number
            }
          }
        }
      ).cameras.main
      return {
        x: Math.round((x! - cam.worldView.x) * cam.zoom + cam.x),
        y: Math.round((y! - cam.worldView.y) * cam.zoom + cam.y),
      }
    },
    [wx, wy] as const,
  )
}

type Touch = { x: number; y: number; id: number }
function touch(
  cdp: CDPSession,
  type: string,
  points: Touch[],
): Promise<unknown> {
  return cdp.send('Input.dispatchTouchEvent', {
    type: type as 'touchStart',
    touchPoints: points,
  })
}

function cityCam(page: Page): Promise<{ x: number; y: number; z: number }> {
  return page.evaluate(() => {
    const c = (
      window.__pm!.game.scene.getScene('City') as unknown as {
        cameras: { main: { scrollX: number; scrollY: number; zoom: number } }
      }
    ).cameras.main
    return { x: c.scrollX, y: c.scrollY, z: c.zoom }
  })
}

test.describe('gestures', () => {
  test('a tap on a locked district’s board shows its unlock toast', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await page.goto(GAME)
    await page.waitForFunction(() => window.__pm?.ready === true, null, {
      timeout: 45_000,
    })
    await skipTour(page)
    await pm.freeze()
    await pm.settle(5)
    const board = await page.evaluate(() => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        labels: Map<
          string,
          {
            locked: boolean
            at: { x: number; y: number }
            sign: { x: number; y: number; height: number } | null
          }
        >
        cameras: { main: { centerOn(x: number, y: number): void } }
      }
      for (const [id, l] of city.labels) {
        if (!l.locked || !l.sign) continue
        city.cameras.main.centerOn(l.at.x, l.at.y)
        return { id, x: l.sign.x, y: Math.round(l.sign.y - l.sign.height / 2) }
      }
      return null
    })
    expect(board, 'a locked region at L1').not.toBeNull()
    await pm.settle(1)
    const s = await screenOf(page, board!.x, board!.y)
    await pm.tap(s.x, s.y)
    await pm.step(16)
    const toast = await page.evaluate(() =>
      (
        window.__pm!.game.scene.getScene('HUD') as unknown as {
          toast: { currentText(): string | null }
        }
      ).toast.currentText(),
    )
    expect(toast ?? '').toMatch(/unlocks at Lv \d/)
    expect(consoleErrors).toEqual([])
  })

  test('a HUD tap during a city pan keeps panning (no pinch, no jump)', async ({
    page,
    consoleErrors,
  }) => {
    await openGame(page)
    const cdp = await page.context().newCDPSession(page)
    const btn = await sceneTarget(page, 'HUD', 'speed:2')
    expect(btn).not.toBeNull()
    const b = await css(page, btn!.x + btn!.w / 2, btn!.y + btn!.h / 2)
    const a = { x: 150, y: 350, id: 1 }
    const hudFinger = { ...b, id: 2 }
    await touch(cdp, 'touchStart', [a])
    for (let i = 0; i < 5; i++) {
      a.x += 6
      await touch(cdp, 'touchMove', [a])
      await frames(page, 1)
    }
    const c1 = await cityCam(page)
    await touch(cdp, 'touchStart', [a, hudFinger])
    await frames(page, 2)
    for (let i = 0; i < 5; i++) {
      a.x += 6
      a.y -= 8
      await touch(cdp, 'touchMove', [a, hudFinger])
      await frames(page, 1)
    }
    const c2 = await cityCam(page)
    await touch(cdp, 'touchEnd', [hudFinger])
    await frames(page, 2)
    for (let i = 0; i < 5; i++) {
      a.x += 6
      await touch(cdp, 'touchMove', [a])
      await frames(page, 1)
    }
    const c3 = await cityCam(page)
    await touch(cdp, 'touchEnd', [a])
    await frames(page, 10)
    // zoom 1: the camera follows the finger 1:1 (scroll moves against it).
    expect(c2, 'panning while the HUD finger is down').toEqual({
      x: c1.x - 30,
      y: c1.y + 40,
      z: 1,
    })
    expect(c3, 'no jump after the HUD finger lifts').toEqual({
      x: c2.x - 30,
      y: c2.y,
      z: 1,
    })
    expect(
      await page.evaluate(() => window.__pm!.stepper.speed),
      'the HUD tap itself landed (2×)',
    ).toBe(2)
    expect(consoleErrors).toEqual([])
  })

  test('pinch while dragging zooms; long-press then drag opens the panel without panning', async ({
    page,
    consoleErrors,
  }) => {
    await openGame(page)
    const cdp = await page.context().newCDPSession(page)
    const a = { x: 120, y: 300, id: 1 }
    await touch(cdp, 'touchStart', [a])
    for (let i = 0; i < 4; i++) {
      a.x += 8
      await touch(cdp, 'touchMove', [a])
      await frames(page, 1)
    }
    const b = { x: 230, y: 300, id: 2 }
    await touch(cdp, 'touchStart', [a, b])
    await frames(page, 2)
    for (let i = 0; i < 6; i++) {
      b.x += 15
      await touch(cdp, 'touchMove', [a, b])
      await frames(page, 1)
    }
    expect((await cityCam(page)).z, 'pinched out to zoom 2').toBe(2)
    await touch(cdp, 'touchEnd', [a, b])
    await frames(page, 5)

    // Long-press a live building, then drag the same finger.
    await skipTour(page)
    await page.evaluate(() => {
      ;(
        window.__pm!.game.scene.getScene('City') as unknown as {
          cameras: { main: { setZoom(z: number): void } }
        }
      ).cameras.main.setZoom(1)
    })
    await frames(page, 2)
    const target = await page.evaluate(() => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        buildings: Map<
          string,
          {
            locked: boolean
            anchor: { x: number; y: number }
            def: { district: string }
            hit(x: number, y: number): boolean
          }
        >
        cameras: {
          main: {
            worldView: { x: number; y: number; width: number; height: number }
            zoom: number
          }
        }
      }
      const v = city.cameras.main.worldView
      const z = city.cameras.main.zoom
      for (const bv of city.buildings.values()) {
        const x = bv.anchor.x
        const y = bv.anchor.y - 24
        // Clear of the HUD bands, chips and cards: the middle of the screen.
        const sx = (x - v.x) * z
        const sy = (y - v.y) * z
        if (sx < 40 || sx > v.width * z - 40) continue
        if (sy < v.height * z * 0.35 || sy > v.height * z * 0.7) continue
        if (!bv.locked && bv.hit(x, y))
          return { x, y, district: bv.def.district }
      }
      return null
    })
    expect(target, 'a live building on screen').not.toBeNull()
    const s = await screenOf(page, target!.x, target!.y)
    const p = await css(page, s.x, s.y)
    // Count the camera drags (the panel itself pans the camera to its label).
    await page.evaluate(() => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        rig: { panBy(dx: number, dy: number): void }
      }
      const w = window as unknown as { pmPanBy: number }
      w.pmPanBy = 0
      const orig = city.rig.panBy.bind(city.rig)
      city.rig.panBy = (dx: number, dy: number): void => {
        w.pmPanBy++
        orig(dx, dy)
      }
    })
    const f = { x: p.x, y: p.y, id: 3 }
    await touch(cdp, 'touchStart', [f])
    await page.waitForTimeout(700)
    await frames(page, 3)
    const held = await page.evaluate(
      () =>
        (
          window.__pm!.game.scene.getScene('City') as unknown as {
            gestures: { gesture: string }
          }
        ).gestures.gesture,
    )
    expect(held, 'the hold became a long-press').toBe('held')
    for (let i = 0; i < 6; i++) {
      f.y += 10
      await touch(cdp, 'touchMove', [f])
      await frames(page, 1)
    }
    await touch(cdp, 'touchEnd', [f])
    await frames(page, 20)
    const after = await page.evaluate(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        district: { isOpen(): boolean } | null
      }
      return {
        panel: hud.district?.isOpen() ?? false,
        drags: (window as unknown as { pmPanBy: number }).pmPanBy,
      }
    })
    expect(after, 'panel open (and still open), the drag did not pan').toEqual({
      panel: true,
      drags: 0,
    })
    expect(consoleErrors).toEqual([])
  })

  test('double-tap follows a vehicle at zoom 2; a building hiding a vehicle wins the tap', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await page.addInitScript(countDomListeners)
    await page.goto(GAME)
    await page.waitForFunction(() => window.__pm?.ready === true, null, {
      timeout: 45_000,
    })
    await loadFixture(page, 'l2-lane')
    await pm.freeze()
    await pm.settle(5)
    await skipTour(page)

    // 1) A visible vehicle at zoom 2: double-tap = follow.
    const v = await page.evaluate(() => {
      type Veh = {
        id: number
        img: {
          depth: number
          getBounds(): { centerX: number; centerY: number }
        }
      }
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        vehicles: Map<number, Veh>
        coveredAt(x: number, y: number, d: number): boolean
        cameras: {
          main: {
            setZoom(z: number): void
            centerOn(x: number, y: number): void
          }
        }
      }
      for (const veh of city.vehicles.values()) {
        const b = veh.img.getBounds()
        if (city.coveredAt(b.centerX, b.centerY, veh.img.depth)) continue
        city.cameras.main.setZoom(2)
        city.cameras.main.centerOn(b.centerX, b.centerY)
        return { id: veh.id }
      }
      return null
    })
    expect(v, 'a vehicle in plain view').not.toBeNull()
    await pm.settle(1)
    const at = await page.evaluate((id) => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        vehicles: Map<
          number,
          { img: { getBounds(): { centerX: number; centerY: number } } }
        >
      }
      const b = city.vehicles.get(id)!.img.getBounds()
      return { x: b.centerX, y: b.centerY }
    }, v!.id)
    const s = await screenOf(page, at.x, at.y)
    await pm.tap(s.x, s.y)
    await pm.step(50)
    await pm.tap(s.x, s.y)
    await pm.step(16)
    const followed = await page.evaluate(
      () =>
        (
          window.__pm!.game.scene.getScene('City') as unknown as {
            followId: number | null
          }
        ).followId,
    )
    expect(followed, 'double-tap at zoom 2 follows the vehicle').toBe(v!.id)
    await page.evaluate(() => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        unfollow(emit: boolean): void
        cameras: { main: { setZoom(z: number): void } }
      }
      city.unfollow(true)
      city.cameras.main.setZoom(1)
    })
    await pm.step(400) // past the double-tap window

    // 2) A vehicle hidden behind a building: the tap picks the building.
    const hidden = await page.evaluate(() => {
      type Veh = {
        img: {
          depth: number
          getBounds(): { x: number; y: number; width: number; height: number }
        }
      }
      const api = window.__pm!
      const city = api.game.scene.getScene('City') as unknown as {
        vehicles: Map<number, Veh>
        coveredAt(x: number, y: number, d: number): boolean
        vehicleAt(x: number, y: number): unknown
        pick(x: number, y: number): { kind: string; view?: { id: string } }
        cameras: {
          main: {
            worldView: { x: number; y: number; width: number; height: number }
            zoom: number
          }
        }
      }
      api.speed(4)
      for (let i = 0; i < 2400; i++) {
        api.step(50)
        const view = city.cameras.main.worldView
        const z = city.cameras.main.zoom
        for (const veh of city.vehicles.values()) {
          const b = veh.img.getBounds()
          for (let dy = 0.3; dy < 0.8; dy += 0.2)
            for (let dx = 0.3; dx < 0.8; dx += 0.2) {
              const x = Math.round(b.x + b.width * dx)
              const y = Math.round(b.y + b.height * dy)
              // On screen, clear of the HUD bands, chips and toasts.
              const sx = (x - view.x) * z
              const sy = (y - view.y) * z
              if (sx < 30 || sx > view.width * z - 30) continue
              if (sy < view.height * z * 0.3 || sy > view.height * z * 0.75)
                continue
              if (!city.coveredAt(x, y, veh.img.depth)) continue
              if (city.vehicleAt(x, y) !== null) continue
              const p = city.pick(x, y)
              if (p.kind === 'building' && p.view) {
                api.speed(1)
                return { wx: x, wy: y, id: p.view.id }
              }
            }
        }
      }
      api.speed(1)
      return null
    })
    expect(
      hidden,
      'a vehicle passes behind a building on screen',
    ).not.toBeNull()
    const hs = await screenOf(page, hidden!.wx, hidden!.wy)
    await pm.tap(hs.x, hs.y)
    await pm.step(16)
    const tip = await page.evaluate(
      () =>
        (
          window.__pm!.game.scene.getScene('City') as unknown as {
            tooltip: { buildingId: string | null }
          }
        ).tooltip.buildingId,
    )
    expect(tip, 'the building in front got the tap (tooltip)').toBe(hidden!.id)
    expect(consoleErrors).toEqual([])
  })
})
