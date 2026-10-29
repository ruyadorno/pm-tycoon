// Smoke test — M0 gallery variant (plan.md §6.9.3 first bullet, §12.3 task
// 15): the build boots under SwiftShader, __pm.ready flips, no console
// errors, the m5x7 BitmapFont is registered from the atlas, the GPU limits
// the ground bake needs are logged/asserted, and the gallery pages are
// captured for review: shots/m0-gallery.png (page 2, every atlas frame) and
// shots/m0-map.png (page 3, the 48x48 map), plus m0-palette / m0-hud.
// Later milestones grow this file one assertion group at a time.
import { expect, test } from './fixtures.ts'

const BASE = '/?view=gallery&debug=1&seed=1&audio=0'

interface BootInfo {
  font: boolean
  /** Opaque pixels of the atlas's m5x7 frame (an empty sheet registers fine but draws nothing). */
  fontPixels: number
  maxTexture: number
  derivatives: boolean
  zoom: number
  displayScale: { x: number; y: number }
  size: { w: number; h: number }
  scene: string | null
}

test.describe('M0 gallery smoke', () => {
  test('boots, registers m5x7, renders pages 1-4 without console errors', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(`${BASE}&page=2`)
    const info = await page.evaluate((): BootInfo => {
      const game = window.__pm!.game
      const r = game.renderer as unknown as {
        getMaxTextureSize(): number
        standardDerivativesExtension: unknown
      }
      const active = game.scene.getScenes(true)
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
        scene: active[0]?.sys.settings.key ?? null,
      }
    })
    console.log(
      `smoke: maxTextureSize=${info.maxTexture} standardDerivatives=${info.derivatives} ` +
        `zoom=${info.zoom} logical=${info.size.w}x${info.size.h} fontPixels=${info.fontPixels}`,
    )
    expect(info.scene).toBe('Gallery')
    expect(info.font, 'cache.bitmapFont.has("m5x7")').toBe(true)
    // Soft: an empty sheet still fails the test, but the shots get written.
    expect
      .soft(info.fontPixels, 'the m5x7 glyph sheet has ink')
      .toBeGreaterThan(200)
    expect(info.maxTexture).toBeGreaterThanOrEqual(4096)
    expect(info.displayScale.x).toBeCloseTo(1 / info.zoom, 6)
    expect(info.displayScale.y).toBeCloseTo(1 / info.zoom, 6)

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
