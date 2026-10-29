// Installs Playwright's Chromium without root (never --with-deps) and probes a SwiftShader WebGL launch;
// success writes node_modules/.pm-chromium-ok, which gates every e2e step (plan.md §6.9.4, R2).
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'

const MARKER = 'node_modules/.pm-chromium-ok'
const ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
]
rmSync(MARKER, { force: true })

function install(what) {
  const r = spawnSync('node_modules/.bin/playwright', ['install', what], {
    stdio: 'inherit',
  })
  return r.status === 0
}

async function probe() {
  const { chromium, devices } = await import('@playwright/test')
  const browser = await chromium.launch({ args: ARGS })
  try {
    const page = await browser.newPage()
    const gl = await page.evaluate(() => {
      const c = document.createElement('canvas')
      const ctx = c.getContext('webgl')
      if (!ctx) return null
      return {
        maxTexture: ctx.getParameter(ctx.MAX_TEXTURE_SIZE),
        derivatives: !!ctx.getExtension('OES_standard_derivatives'),
      }
    })
    if (!gl) throw new Error('no WebGL context under SwiftShader')
    const device = devices['iPhone 16'] ? 'iPhone 16' : 'iPhone 15 Pro'
    return { version: browser.version(), device, ...gl }
  } finally {
    await browser.close()
  }
}

for (const what of ['chromium', 'chromium-headless-shell']) {
  if (!install(what)) continue
  try {
    const info = await probe()
    writeFileSync(MARKER, JSON.stringify(info) + '\n')
    console.log(`e2e-install: OK ${JSON.stringify(info)}`)
    process.exit(0)
  } catch (err) {
    console.error(
      `e2e-install: launch probe failed after "${what}": ${err.message}`,
    )
  }
}
console.error(
  'e2e-install: Chromium unavailable — e2e steps will be SKIPPED (plan.md §6.9.4)',
)
process.exit(1)
