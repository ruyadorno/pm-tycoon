// The web icons' source render (docs/decisions.md "After M15 — browser and
// home-screen icons"; tools/art/webicons.ts): a 512×512 close-up of the real
// City around the L5 HQ (`wh_ext_t5`), 1 art px = 1 px, read back from the
// renderer, never the screen (DPR-independent). The state is the `tycoon`
// session config at tick 0 (public/configs/tycoon.json: L5, tier 5, three
// docks, the fleet parked on the lot), so the render needs no fixture and
// never goes stale with one; the sim is held (speed 0) and the City paused
// once its views are built. Only the city is drawn: the HUD and the Garage
// do not render, and every overlay is hidden — the marker band and above
// (badges, rush bells, hub rings, district plates, popups, tooltip), vehicle
// zone dots and glyphs, transient fx and the days-without-incident sign
// (text has no place in an icon).
//   - always: the capture lands in shots/webicon-src.png (gitignored) and the
//     test checks the recipe — the HQ frame is wh_ext_t5, zoom 1, the camera
//     centred on warehouseCentre() without a bounds clamp, the picture opaque;
//   - `vlr webicons:capture` (PM_WEBICONS=1) also overwrites the committed
//     source art/webicon-src.png and then re-cuts every icon.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { WEBICON_SRC, WEBICON_SRC_SIDE } from '../tools/art/webicons.ts'
import { deckOff, expect, quietHints, SHOTS_DIR, test } from './fixtures.ts'

const URL = '/?seed=7&debug=1&mute=1&audio=0&skipTitle=1&config=tycoon'
const S = WEBICON_SRC_SIDE
/** The City's marker band (BuildingView DEPTH.marker): every overlay sits at or above it. */
const OVERLAY_DEPTH = 8000

test.use({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
})

test('webicon source: the L5 HQ in the city, overlays hidden', async ({
  page,
  pm,
  consoleErrors,
}) => {
  await pm.open(URL)
  await pm.freeze()
  await quietHints(page)
  await deckOff(page)
  await page.evaluate(() => {
    const api = window.__pm!
    api.speed(0)
    ;(api.game.registry.get('quality') as { set(n: number): void } | null)?.set(
      0,
    )
  })
  await pm.overlay(false)
  await page.evaluate((side) => {
    const game = window.__pm!.game
    for (const s of game.scene.getScenes(false))
      if (s.sys.settings.key !== 'City') s.sys.setVisible(false)
    game.scale.resize(side, side)
  }, S)
  await pm.settle(20)
  const state = await page.evaluate(
    ([side, overlayDepth]) => {
      const api = window.__pm!
      const game = api.game
      type Shown = { visible: boolean; setVisible(on: boolean): unknown }
      const city = game.scene.getScene('City') as unknown as {
        cameras: {
          main: {
            zoom: number
            setZoom(z: number): unknown
            setScroll(x: number, y: number): unknown
            stopFollow(): unknown
          }
        }
        rig: { stop(): void }
        world: { getChildren(): (Shown & { depth: number })[] }
        vehicles: Map<number, { glyph: Shown | null; dot: Shown | null }>
        fx: { img: Shown }[]
        sign: Shown | null
        signText: Shown | null
        warehouse: { frame: { name: string } } | null
        warehouseCentre(): { x: number; y: number }
      }
      const cam = city.cameras.main
      const c = city.warehouseCentre()
      city.rig.stop()
      cam.stopFollow()
      cam.setZoom(1)
      cam.setScroll(c.x - side! / 2, c.y - side! / 2)
      // no City.update from here on: it would re-show glyphs and dock lamps
      game.scene.pause('City')
      let hidden = 0
      for (const o of city.world.getChildren())
        if (o.depth >= overlayDepth! && o.visible) {
          o.setVisible(false)
          hidden++
        }
      for (const v of city.vehicles.values()) {
        v.glyph?.setVisible(false)
        v.dot?.setVisible(false)
      }
      for (const f of city.fx) f.img.setVisible(false)
      city.sign?.setVisible(false)
      city.signText?.setVisible(false)
      return {
        centre: c,
        zoom: cam.zoom,
        canvas: { w: game.scale.width, h: game.scale.height },
        frame: city.warehouse?.frame.name ?? null,
        level: api.core.state.level.level,
        tier: api.core.state.level.warehouseTier,
        vehicles: city.vehicles.size,
        hidden,
      }
    },
    [S, OVERLAY_DEPTH] as const,
  )
  console.log(`webicons: capture ${JSON.stringify(state)}`)
  expect(state).toMatchObject({
    frame: 'wh_ext_t5',
    level: 5,
    tier: 5,
    zoom: 1,
    canvas: { w: S, h: S },
  })
  expect(state.vehicles).toBeGreaterThan(0)

  const snap = await page.evaluate(
    (side) =>
      new Promise<{ src: string; view: { x: number; y: number } }>(
        (resolve, reject) => {
          const api = window.__pm!
          const game = api.game
          const cam = (
            game.scene.getScene('City') as unknown as {
              cameras: { main: { worldView: { x: number; y: number } } }
            }
          ).cameras.main
          const renderer = game.renderer as unknown as {
            snapshotArea(
              x: number,
              y: number,
              w: number,
              h: number,
              cb: (img: unknown) => void,
              type?: string,
            ): void
          }
          // serviced in the next frame's postRender: arm it, then step once
          renderer.snapshotArea(
            0,
            0,
            side,
            side,
            (img) =>
              img instanceof HTMLImageElement
                ? resolve({
                    src: img.src,
                    view: { x: cam.worldView.x, y: cam.worldView.y },
                  })
                : reject(new Error('snapshotArea gave no image')),
            'image/png',
          )
          api.step(16)
        },
      ),
    S,
  )
  // the frame drawn was centred on the HQ, not clamped by the camera bounds
  expect(snap.view).toEqual({
    x: state.centre.x - S / 2,
    y: state.centre.y - S / 2,
  })
  const raw = Buffer.from(snap.src.slice(snap.src.indexOf(',') + 1), 'base64')
  const stats = await sharp(raw).stats()
  // opaque: iOS shows a transparent home-screen icon on black
  expect(stats.channels[3]?.min ?? 255, 'snapshot alpha').toBe(255)
  const png = await sharp(raw)
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  const meta = await sharp(png).metadata()
  expect([meta.width, meta.height, meta.channels]).toEqual([S, S, 3])
  const shot = join(SHOTS_DIR, 'webicon-src.png')
  mkdirSync(SHOTS_DIR, { recursive: true })
  writeFileSync(shot, png)
  let same = false
  try {
    same = readFileSync(WEBICON_SRC).equals(png)
  } catch {
    same = false
  }
  console.log(
    `webicons: ${shot} ${(png.length / 1024).toFixed(1)} KB, ` +
      `${same ? 'same as' : 'differs from'} the committed ${WEBICON_SRC}`,
  )
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  // last, once every check passed: a failed capture never replaces the source
  if (process.env.PM_WEBICONS === '1') {
    writeFileSync(WEBICON_SRC, png)
    console.log(`webicons: wrote ${WEBICON_SRC}`)
  }
})
