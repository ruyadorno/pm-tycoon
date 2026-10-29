// Playwright (plan.md §6.3, §6.9.3): Chromium under SwiftShader for every
// project (WebKit headless WebGL on Linux is not a target, phaser4-notes.md
// §10). `vlr preview` serves the last `vite build`, which every e2e script
// runs first — so every project runs against the production bundle; the
// `dist` project holds the specs about the build itself (e2e/dist.spec.ts).
import { defineConfig, devices } from '@playwright/test'

export const BASE_URL = 'http://127.0.0.1:4173'
export const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
]

const PHONE_NAME = devices['iPhone 16'] ? 'iPhone 16' : 'iPhone 15 Pro'
const phone = devices['iPhone 16'] ?? devices['iPhone 15 Pro']
if (!process.env.PM_PW_QUIET) {
  console.log(
    `playwright: project iphone16 uses the "${PHONE_NAME}" descriptor`,
  )
  process.env.PM_PW_QUIET = '1'
}

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    launchOptions: { args: LAUNCH_ARGS },
  },
  projects: [
    {
      name: 'iphone16',
      testIgnore: /dist\.spec\.ts/,
      use: { ...phone, browserName: 'chromium' },
    },
    {
      // The playtest build as served (plan.md §12.7 acceptance): the same
      // preview of dist/, the iPhone 16 profile, e2e/dist.spec.ts only.
      name: 'dist',
      testMatch: /dist\.spec\.ts/,
      use: { ...phone, browserName: 'chromium' },
    },
    {
      // The desktop portrait column (430x932, DPR 2) — for the shots only.
      name: 'desktop-column',
      testMatch: /shots\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 430, height: 932 },
        deviceScaleFactor: 2,
      },
    },
    {
      // The 360x604 minimum-fit phone (plan.md §6.9.3, warehouse-view.md
      // §1.1 / §7.5) — the M2 warehouse and card shots only.
      name: 'min-fit',
      testMatch: /shots\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 360, height: 604 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'vlr preview',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
