// Playwright (plan.md §6.3, §6.9.3): Chromium under SwiftShader for every
// project (WebKit headless WebGL on Linux is not a target, phaser4-notes.md
// §10). `vlr preview` serves the last `vite build`, which every e2e script
// runs first.
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
  ],
  webServer: {
    command: 'vlr preview',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
