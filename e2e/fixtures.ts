// Playwright fixtures (phaser4-notes.md §10, plan.md §6.9.3). The projects in
// playwright.config.ts already launch Chromium with the SwiftShader args and
// the iPhone 16 / desktop-column profiles; these fixtures add
//   - consoleErrors: every console.error + uncaught page error (auto);
//   - pm: helpers over window.__pm — open(url) waits for __pm.ready, the
//     frozen-clock helpers (freeze / advance / settle / step / stamp),
//     shot(name) = a `scale: 'device'` PNG in shots/ with the overlay hidden,
//     and tap(x, y) = a real touch/mouse tap at logical game px;
//   - titleUp(page) / gameUp(page) (build 2, B2 §5): the Title is up over
//     the attract city (or, with attract = false, the ?attract=0 Title), and
//     the player's game is in after Continue / New game (ready, HUD up, the
//     Title gone, no attract sim).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, expect, type Page } from '@playwright/test'

export const SHOTS_DIR = 'shots'
export const READY_TIMEOUT_MS = 45_000

/**
 * Wait for the Title. `attract` (the default flow): over the running attract
 * city with its sim installed; false: just the Title scene (?attract=0).
 */
export async function titleUp(
  page: Page,
  attract = true,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  await page.waitForFunction(
    (a) => {
      const pm = window.__pm
      if (!pm || !pm.game.scene.isActive('Title')) return false
      if (!a) return true
      const city = pm.game.scene.getScene('City') as unknown as {
        attract?: boolean
      } | null
      return (
        pm.attractSim !== null &&
        pm.game.scene.isActive('City') &&
        city?.attract === true
      )
    },
    attract,
    { timeout: timeoutMs },
  )
}

/** After Continue / New game: ready, the HUD up, the Title gone, no attract sim. */
export async function gameUp(
  page: Page,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const pm = window.__pm
      if (!pm?.ready) return false
      const sm = pm.game.scene
      return (
        sm.isActive('City') &&
        sm.isActive('HUD') &&
        !sm.isActive('Title') &&
        pm.attractSim === null
      )
    },
    null,
    { timeout: timeoutMs },
  )
}

export interface PmHelpers {
  /** page.goto(url), then wait for window.__pm.ready. */
  open(url: string): Promise<void>
  ready(timeoutMs?: number): Promise<void>
  freeze(): Promise<void>
  thaw(): Promise<void>
  /** Sim-only advance (no render). */
  advance(ms: number): Promise<void>
  /** n frames of 16 ms through TimeStep (update + render each). */
  settle(frames?: number): Promise<void>
  step(ms?: number): Promise<void>
  stamp(text: string): Promise<void>
  overlay(on: boolean): Promise<void>
  /**
   * Freeze, hide the overlay, pin the stamp, settle, then save
   * shots/<name>.png at device scale. Returns the path.
   */
  shot(name: string, settleFrames?: number): Promise<string>
  /**
   * A real tap at logical game px (x, y): canvas offset + `scale.zoom`
   * → CSS px, then a touch tap (touch profiles) or a mouse click.
   */
  tap(x: number, y: number): Promise<void>
}

function helpers(page: Page): PmHelpers {
  const call = async (fn: string, ...args: unknown[]): Promise<void> => {
    await page.evaluate(
      ([f, a]) => {
        const pm = window.__pm as unknown as Record<
          string,
          (...x: unknown[]) => unknown
        >
        pm[f as string]!(...(a as unknown[]))
      },
      [fn, args] as const,
    )
  }
  const h: PmHelpers = {
    async open(url) {
      await page.goto(url)
      await h.ready()
    },
    async ready(timeoutMs = READY_TIMEOUT_MS) {
      await page.waitForFunction(() => window.__pm?.ready === true, null, {
        timeout: timeoutMs,
      })
    },
    freeze: () => call('freeze'),
    thaw: () => call('thaw'),
    advance: (ms) => call('advance', ms),
    settle: (frames = 60) => call('settle', frames),
    step: (ms = 16) => call('step', ms),
    stamp: (text) => call('stamp', text),
    overlay: (on) => call('overlay', on),
    async shot(name, settleFrames = 20) {
      await h.freeze()
      await h.overlay(false)
      await h.stamp('test')
      await h.settle(settleFrames)
      mkdirSync(SHOTS_DIR, { recursive: true })
      const path = join(SHOTS_DIR, `${name}.png`)
      await page.screenshot({ path, scale: 'device' })
      return path
    },
    async tap(x, y) {
      const p = await page.evaluate(
        ([lx, ly]) => {
          const game = window.__pm!.game
          const r = game.canvas.getBoundingClientRect()
          const z = game.scale.zoom
          return {
            x: r.left + (lx! + 0.5) * z,
            y: r.top + (ly! + 0.5) * z,
            touch: navigator.maxTouchPoints > 0,
          }
        },
        [x, y] as const,
      )
      if (p.touch) await page.touchscreen.tap(p.x, p.y)
      else await page.mouse.click(p.x, p.y)
    },
  }
  return h
}

export const test = base.extend<{ consoleErrors: string[]; pm: PmHelpers }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
        // A frame asked of the wrong atlas (world vs interior, M5): Phaser
        // only warns "Texture.frame missing: … has no frame …" and draws
        // the atlas's first frame instead — a silent bug unless it fails here.
        else if (m.type() === 'warning' && /has no frame/.test(m.text()))
          errors.push(`warning: ${m.text()}`)
      })
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      await use(errors)
    },
    { auto: true },
  ],
  pm: async ({ page }, use) => {
    await use(helpers(page))
  },
})

export { expect }
