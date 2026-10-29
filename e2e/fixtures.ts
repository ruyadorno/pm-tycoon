// Playwright fixtures (phaser4-notes.md §10, plan.md §6.9.3). The projects in
// playwright.config.ts already launch Chromium with the SwiftShader args and
// the iPhone 16 / desktop-column profiles; these fixtures add
//   - consoleErrors: every console.error + uncaught page error (auto);
//   - pm: helpers over window.__pm — open(url) waits for __pm.ready, the
//     frozen-clock helpers (freeze / advance / settle / step / stamp) and
//     shot(name) = a `scale: 'device'` PNG in shots/ with the overlay hidden.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, expect, type Page } from '@playwright/test'

export const SHOTS_DIR = 'shots'
export const READY_TIMEOUT_MS = 45_000

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
  }
  return h
}

export const test = base.extend<{ consoleErrors: string[]; pm: PmHelpers }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
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
