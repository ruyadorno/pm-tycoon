// Shots (plan.md §6.9.3 second bullet, §12.4 task 16): the twelve M1 PNGs,
// written to shots/ at device scale under the frozen clock (freeze → advance
// → settle, stamp('test'), the debug overlay hidden; e2e/fixtures.ts shot()).
// Read by the agent against art/STYLE.md + city-view.md (no pixel diffs).
//
//   iphone16        title, city-0s, city-30s, city-first-delivery,
//                   city-zoom2, city-rush, city-late-badge, city-locked,
//                   garage, garage-zone-picker, district-panel, paused
//   desktop-column  city-30s-430x932, garage-430x932 (the 430×932 column)
//
// Every city shot from city-30s on loads `&policy=1` or a fixture through
// __pm.load (§6.9.3 rule: a page that must contain vehicles has a source of
// vehicles). city-late-badge loads tests/fixtures/late-waiting.json — one
// building with an amber and one with a red waiting badge; regenerate it
// with `node tools/fixtures/late-waiting.ts` after any data change (its
// dataHash must match the build's, checked below). `?mute=1` is the shots
// default (audio.md: sound on, muted).
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test, type PmHelpers } from './fixtures.ts'

const BASE = '/?seed=7&debug=1&mute=1'
const CITY = `${BASE}&skipTitle=1`
const POLICY = `${CITY}&policy=1`
const FIXTURE = 'tests/fixtures/late-waiting.json'

interface Pt {
  x: number
  y: number
}

const isColumn = (): boolean => test.info().project.name === 'desktop-column'

/** iPhone-only shots; the 430×932 column takes city-30s and garage only. */
function phoneOnly(): void {
  test.skip(isColumn(), 'the 430×932 column only takes city-30s and garage')
}

/** `<name>` on the phone, `<name>-430x932` in the desktop column. */
function shotName(name: string): string {
  return isColumn() ? `${name}-430x932` : name
}

/**
 * Sim-only advance under the frozen clock, then settle the view for 1 s so
 * the HUD's money counter / floats started by the advance's events have run
 * out (900 ms floats, 300 ms counter).
 */
async function runFor(page: Page, pm: PmHelpers, ms: number): Promise<void> {
  await pm.freeze()
  await page.evaluate((t) => window.__pm!.advance(t), ms)
  await pm.settle(64)
}

/** World point → logical screen px through the City main camera. */
function cityScreen(page: Page, w: Pt): Promise<Pt> {
  return page.evaluate((p) => {
    const cam = window.__pm!.game.scene.getScene('City').cameras.main
    const v = cam.worldView
    return {
      x: Math.round((p.x - v.x) * cam.zoom),
      y: Math.round((p.y - v.y) * cam.zoom),
    }
  }, w)
}

/** A building sprite's visual centre (anchor bottom vertex → top) in world px. */
function buildingCentre(page: Page, id: string): Promise<Pt> {
  return page.evaluate((bid) => {
    const city = window.__pm!.game.scene.getScene('City') as unknown as {
      buildings: Map<string, { anchor: Pt; topY: number }>
    }
    const b = city.buildings.get(bid)
    if (!b) throw new Error(`no BuildingView ${bid}`)
    return { x: b.anchor.x, y: Math.round((b.anchor.y + b.topY) / 2) }
  }, id)
}

/** Centre the City camera on a world point now (City's own focus rule). */
async function focusCity(page: Page, w: Pt): Promise<void> {
  await page.evaluate((p) => {
    const city = window.__pm!.game.scene.getScene('City') as unknown as {
      focusOn(x: number, y: number, ms: number): void
    }
    city.focusOn(p.x, p.y, 0)
  }, w)
}

function emit(page: Page, name: string, payload: unknown): Promise<void> {
  return page.evaluate(
    ([n, p]) => {
      window.__pm!.game.events.emit(n as string, p)
    },
    [name, payload] as const,
  )
}

/** The HUD's layout rect of a fixed target (layout.ts). */
function hudRect(
  page: Page,
  name: 'warehouse' | 'garage',
): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate((n) => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      L: Record<
        string,
        { rect: { x: number; y: number; w: number; h: number } }
      >
    }
    return hud.L[n]!.rect
  }, name)
}

/** Real tap on the HUD Garage button, then let the sheet slide in. */
async function openGarage(page: Page, pm: PmHelpers): Promise<void> {
  const r = await hudRect(page, 'garage')
  await pm.tap(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2))
  await pm.settle(40)
  const open = await page.evaluate(() => {
    const g = window.__pm!.game.scene.getScene('Garage') as unknown as {
      garageSheet: { isOpen(): boolean } | null
    }
    return g.garageSheet?.isOpen() ?? false
  })
  expect(open, 'the Garage sheet is open').toBe(true)
}

test.describe('M1 shots', () => {
  test('title', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await page.goto(BASE)
    // __pm.ready waits for the world scene; the Title comes first.
    await page.waitForFunction(
      () => window.__pm?.game.scene.isActive('Title') === true,
      null,
      { timeout: 45_000 },
    )
    await pm.shot('title', 40)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('city-0s', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    // No policy: a new game owns no vehicle (spec §7.1) — the empty lot and
    // onboarding step 1 pointing at the Garage.
    await pm.open(CITY)
    await pm.shot('city-0s', 30)
    const st = await page.evaluate(() => ({
      vehicles: window.__pm!.sim.vehicles.length,
      tick: window.__pm!.sim.tick,
    }))
    expect(st.vehicles).toBe(0)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('city-30s', async ({ page, pm, consoleErrors }) => {
    await pm.open(POLICY)
    await runFor(page, pm, 30_000)
    await pm.shot(shotName('city-30s'))
    const v = await page.evaluate(() => window.__pm!.sim.vehicles.length)
    expect(v).toBeGreaterThan(0)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('city-first-delivery', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(POLICY)
    await pm.freeze()
    // The opening bike leaves the dock with its first outbound parcels …
    const dep = await page.evaluate(() =>
      window.__pm!.waitEvent('vehicle:departed'),
    )
    expect(dep.ok, 'the policy bike departs to deliver within 60 s').toBe(true)
    // … to its first stop: centre that building and render a frame pair
    // per sim tick until the delivery lands there (popup + money float).
    const dest = await page.evaluate((id) => {
      const v = window.__pm!.sim.vehicles.find((x) => x.id === id)
      return v?.cargo[0]?.destId ?? null
    }, dep.payload!.id)
    expect(dest, 'the departing bike carries a parcel').not.toBeNull()
    await focusCity(page, await buildingCentre(page, dest!))
    const run = await page.evaluate(() => {
      const api = window.__pm!
      const st = (): number => api.core.state.stats.deliveries
      const start = st()
      let ticks = 0
      while (st() === start && ticks < 3000) {
        api.advance(100)
        api.step(16)
        api.step(16)
        ticks++
      }
      return { delivered: st() - start, t: api.sim.tick / 10 }
    })
    console.log(`shots: first delivery at ${run.t} s`)
    expect(run.delivered).toBe(1)
    // 22 frames: the counter has landed, the DELIVERED stamp is mid-rise.
    await pm.shot('city-first-delivery', 22)
    const alive = await page.evaluate(
      () =>
        (
          window.__pm!.game.scene.getScene('City') as unknown as {
            popups: { alive: number }
          }
        ).popups.alive,
    )
    expect(alive, 'the delivery popup is on screen').toBeGreaterThan(0)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('city-zoom2', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(POLICY)
    await runFor(page, pm, 45_000)
    // Follow the first bike, then the wheel zooms in (GestureClassifier
    // wheel → CameraRig.zoomAt(2)); the follow keeps it centred.
    const id = await page.evaluate(() => window.__pm!.sim.vehicles[0]!.id)
    await emit(page, 'pm:follow', { vehicleId: id })
    await pm.settle(40)
    const W = await page.evaluate(() => window.__pm!.game.scale.width)
    const H = await page.evaluate(() => window.__pm!.game.scale.height)
    const c = await page.evaluate(
      ([x, y]) => {
        const game = window.__pm!.game
        const r = game.canvas.getBoundingClientRect()
        return {
          x: r.left + x! * game.scale.zoom,
          y: r.top + y! * game.scale.zoom,
        }
      },
      [Math.round(W / 2), Math.round(H / 2)] as const,
    )
    await page.mouse.move(c.x, c.y)
    await page.mouse.wheel(0, -120)
    await pm.settle(10)
    let zoom = await page.evaluate(
      () => window.__pm!.game.scene.getScene('City').cameras.main.zoom,
    )
    if (zoom !== 2) {
      // Some mobile profiles drop synthetic wheel events: zoom like a
      // double-tap does.
      await page.evaluate(
        ([x, y]) => {
          const city = window.__pm!.game.scene.getScene('City') as unknown as {
            rig: { zoomAt(z: 1 | 2, px: number, py: number): void }
          }
          city.rig.zoomAt(2, x!, y!)
        },
        [Math.round(W / 2), Math.round(H / 2)] as const,
      )
      zoom = 2
    }
    await pm.settle(60)
    await pm.shot('city-zoom2')
    expect(
      await page.evaluate(
        () => window.__pm!.game.scene.getScene('City').cameras.main.zoom,
      ),
    ).toBe(2)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('city-rush', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(POLICY)
    await runFor(page, pm, 30_000)
    // Step the sim in 1-s hops until a vehicle could take a rush (idle on the
    // lot or collecting, with room, spec §4.1) and a live building has a
    // waiting parcel that fits it; take the building nearest that vehicle.
    const target = await page.evaluate(() => {
      const api = window.__pm!
      const vs = api.sim
      const units = (size: string): number =>
        (api.data.parcels.sizes as Record<string, { units: number }>)[size]!
          .units
      for (let i = 0; i < 180; i++) {
        for (const v of vs.vehicles) {
          if (v.state !== 'idle_lot' && v.state !== 'collecting') continue
          if (v.rushBuildingId !== null) continue
          const room = v.capacityUnits - v.unitsUsed
          const sizes =
            api.data.vehicles.types.find((t) => t.id === v.type)?.sizes ?? []
          let best: { id: string; d: number } | null = null
          for (const b of api.data.buildings) {
            if (vs.regionState(b.district) !== 'live') continue
            if (vs.rushState(b.id)) continue
            const fits = vs
              .waitingAt(b.id)
              .some(
                (p) =>
                  p.reservedBy === null &&
                  (sizes as string[]).includes(p.size) &&
                  units(p.size) <= room,
              )
            if (!fits) continue
            const d = Math.hypot(b.anchor[0] - v.cur.tx, b.anchor[1] - v.cur.ty)
            if (!best || d < best.d) best = { id: b.id, d }
          }
          if (best) return best.id
        }
        api.advance(1000)
      }
      return null
    })
    expect(target, 'a rushable building').not.toBeNull()
    // Hold the sim (❚❚) while the camera settles so the vehicle stays free.
    await page.evaluate(() => window.__pm!.speed(0))
    await pm.settle(64)
    const centre = await buildingCentre(page, target!)
    await focusCity(page, centre)
    await pm.settle(4)
    const s = await cityScreen(page, centre)
    await pm.tap(s.x, s.y)
    await page.evaluate(() => window.__pm!.speed(1))
    await pm.settle(20)
    const rush = await page.evaluate(
      (id) => window.__pm!.sim.rushState(id),
      target!,
    )
    console.log(`shots: rushed ${target} → ${JSON.stringify(rush)}`)
    expect(rush, 'the tap rushed the building').not.toBeNull()
    expect(rush!.vehicleId, 'a vehicle took the rush').not.toBeNull()
    await pm.shot('city-rush', 10)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('city-late-badge', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    const text = readFileSync(FIXTURE, 'utf8')
    const fx = JSON.parse(text) as {
      dataHash: string
      fixture: { amber: string; red: string; regenerate: string }
    }
    await pm.open(CITY)
    const hash = await page.evaluate(() => window.__pm!.data.hash)
    expect(
      fx.dataHash,
      `${FIXTURE} is stale (data changed): run \`${fx.fixture.regenerate}\``,
    ).toBe(hash)
    await pm.freeze()
    await page.evaluate((json) => window.__pm!.load(json), text)
    await pm.settle(5)
    const a = await buildingCentre(page, fx.fixture.amber)
    const r = await buildingCentre(page, fx.fixture.red)
    await focusCity(page, {
      x: Math.round((a.x + r.x) / 2),
      y: Math.round((a.y + r.y) / 2),
    })
    await pm.shot('city-late-badge')
    const phases = await page.evaluate(
      ([amber, red]) => {
        const api = window.__pm!
        const vs = api.sim
        const { graceS } = api.data.parcels.decay
        const onTime = api.data.parcels.onTimeMaxS
        const phase = (id: string): string => {
          const w = vs.waitingAt(id)
          const age = (vs.tick - Math.min(...w.map((p) => p.spawnedTick))) / 10
          return age <= graceS ? 'plain' : age <= onTime ? 'amber' : 'red'
        }
        return [phase(amber!), phase(red!)]
      },
      [fx.fixture.amber, fx.fixture.red] as const,
    )
    expect(phases).toEqual(['amber', 'red'])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('city-locked', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(POLICY)
    await runFor(page, pm, 30_000)
    // A real tap on the locked chip (Hoist Hill 🔒Lv2) pans the camera there.
    const chip = await page.evaluate(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        chips: { entry: { id: string }; x: number; w: number }[]
        chipScroll: number
        L: { chips: { y: number; h: number } }
      }
      const c = hud.chips.find((x) => x.entry.id === 'industrial')
      if (!c) return null
      return {
        x: Math.round(c.x + hud.chipScroll + c.w / 2),
        y: hud.L.chips.y + Math.floor(hud.L.chips.h / 2),
      }
    })
    expect(chip, 'the Hoist Hill chip').not.toBeNull()
    await pm.tap(chip!.x, chip!.y)
    await pm.settle(40)
    expect(
      await page.evaluate(() => window.__pm!.sim.regionState('industrial')),
    ).toBe('locked')
    await pm.shot('city-locked')
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('garage', async ({ page, pm, consoleErrors }) => {
    await pm.open(POLICY)
    // ~4 min: the policy owns three bikes (spec §7: a bike at price + $50).
    await runFor(page, pm, 240_000)
    await openGarage(page, pm)
    await pm.shot(shotName('garage'))
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('garage-zone-picker', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(POLICY)
    await runFor(page, pm, 240_000)
    await openGarage(page, pm)
    // Real tap on the first row's zone chip (`Any ▾`).
    const z = await page.evaluate(() => {
      const g = window.__pm!.game.scene.getScene('Garage') as unknown as {
        rows: {
          c: { y: number }
          zone: { x: number; y: number; btnWidth: number; btnHeight: number }
        }[]
        garageSheet: {
          listViewport(): { x: number; y: number } | null
          scrollY: number
        }
      }
      const row = g.rows[0]
      const vp = g.garageSheet.listViewport()
      if (!row || !vp) return null
      return {
        x: Math.round(vp.x + row.zone.x + row.zone.btnWidth / 2),
        y: Math.round(
          vp.y +
            row.c.y +
            row.zone.y -
            g.garageSheet.scrollY +
            row.zone.btnHeight / 2,
        ),
      }
    })
    expect(z, 'a fleet row with a zone chip').not.toBeNull()
    await pm.tap(z!.x, z!.y)
    await pm.settle(20)
    const open = await page.evaluate(() => {
      const g = window.__pm!.game.scene.getScene('Garage') as unknown as {
        picker: { isOpen(): boolean } | null
      }
      return g.picker?.isOpen() ?? false
    })
    expect(open, 'the ZonePicker is open').toBe(true)
    await pm.shot('garage-zone-picker')
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('district-panel', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(POLICY)
    await runFor(page, pm, 90_000)
    // City's tap on an empty Registry Row tile emits this (contract event).
    await emit(page, 'pm:select', { kind: 'district', id: 'downtown' })
    await pm.settle(40)
    const open = await page.evaluate(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        district: { isOpen(): boolean; districtId: string | null } | null
      }
      return hud.district?.isOpen() ? hud.district.districtId : null
    })
    expect(open).toBe('downtown')
    await pm.shot('district-panel')
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('paused', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(POLICY)
    await runFor(page, pm, 30_000)
    // Auto-pause (spec §2): the tab hides then returns. Phaser's own
    // HIDDEN/VISIBLE handlers reset the TimeStep, so this runs thawed.
    await pm.thaw()
    await emit(page, 'hidden', undefined)
    await emit(page, 'visible', undefined)
    await page.waitForTimeout(300)
    const st = await page.evaluate(() => ({
      paused: window.__pm!.stepper.paused,
      card: (
        window.__pm!.game.scene.getScene('HUD') as unknown as {
          paused: { isOpen(): boolean }
        }
      ).paused.isOpen(),
    }))
    expect(st).toEqual({ paused: true, card: true })
    await pm.shot('paused')
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})
