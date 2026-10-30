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
//
// M2 (plan.md §12.5 task 11, warehouse-view.md §7.5, city-view.md §9.3-§9.4),
// at the iPhone 16 profile and the 360×604 minimum-fit profile (`min-fit`,
// names suffixed `-360x604`):
//   warehouse-l1       ?view=warehouse + policy, t = 60 s
//   warehouse-catch    policy 60 s, then policy off + debug.forceFlagNext:
//                      frozen 300 ms into the catch moment (§3.3)
//   warehouse-holdcard the forced flag in bay 1, tapped → HoldBayCard
//   warehouse-stalled  fixture tests/fixtures/holdbay-full.json (Hold Bay at
//                      cap, a flagged parcel waiting dark in slot 1)
//   warehouse-buysheet policy 60 s, the first empty slot tapped → BuySheet
//   lost-life          fixture malware-cleared.json + advance to the
//                      delivery of the parcel the player Cleared
//   game-over          fixture one-life.json + advance to the third loss
// The M2 fixtures come from `node tools/fixtures/warehouse.ts` (same
// staleness rule; tests/data/shot-fixtures.test.ts pins their scenarios).
//
// M3 (plan.md §12.6 task 12; city-view.md §1.4, §5.3, §8.2, §9.6-§9.7;
// warehouse-view.md §5, §7.5), fixtures from `node tools/fixtures/m3.ts`:
//   level-up            level-up.json + policy, camera on the warehouse,
//                       frozen on dust frame 2 of the construction overlay
//                       (500-749 ms after level:up) with the LEVEL stamp
//   industrial-unlocked level-up.json + policy, camera on Hoist Hill, after
//                       the 1-s fog cross-fade (sign popped, chip NEW)
//   newspaper           level-up.json + policy: the level paper, which slides
//                       up once the stamp has played (STAMP_MS, §9.6 step 3)
//   shield-popover      level-up.json + policy, past the level-up: the real
//                       shield tap → metal + rattle rows, "→ Shaky shaker"
//   payroll-short       payroll-short.json WITHOUT the policy: $0 at the
//                       day-4 payday → red toast + the Garage "!"
//   city-10min          seed 7, ?policy=1&fastForward=600 (t = 600 s)
//   warehouse-tier2     level-up.json + policy in the room: level:up while
//                       inside → tier-2 cross-fade + slot-4 unroll, settled
//   warehouse-l2        l2-lane.json + policy: L2 in play, 4 slots, the
//                       Shaky shaker in slot 4 (+ `-360x604`)
// The two warehouse shots also run at the 360×604 profile.
//
// M4 (plan.md §12.7 tasks 1-2, §12.9):
//   playtest-12min  iPhone 16: the 12-minute automated run (seed 7, policy)
//                   in real time at 4× — the recorder's wall clock, fps
//                   sampler and pause clock see a real session; 5:00-6:00 in
//                   the Warehouse — then ❚❚, ❚❚ again (the pause menu) and
//                   `End run — show summary` by real taps: the `summary-card`
//                   shot, and the profile written to tests/playtest/seed-7.json
//                   (the committed format example; tests/metrics/
//                   playtest-schema.test.ts validates it)
//   summary-card    360×604 (`-360x604`): policy 10 min frozen, the same taps
//   summary-over    iPhone 16 (no PNG): one-life.json to game over, the
//                   game-over card's `Run summary` → the card in `Back` mode
//                   → Back returns to the game-over card
//
// M5 (plan-build2 §8.2 task 12 + acceptance; B2 §5, §6):
//   title           the logo over the attract city (the Title is an overlay
//                   on the City in attract mode, its camera still holding on
//                   the lot), no HUD; also in the 430×932 column
//                   (title-430x932)
//   city-lot-zoom2  a new game at camera zoom 2 on the lot's front (S)
//                   vertex with __pm.debugLotCorners(true): magenta crosses
//                   on the footprint's corners (iso tileToScreen; the S one
//                   and both front edges in frame) to read the slab against
//                   the grid
//   city-bike       policy 40 s, the camera following the first bike at
//                   zoom 2 (the courier on a bicycle with a helmet, B2 §6.2)
//   city-hop        policy: the first bike followed at zoom 2, its first
//                   pickup rendered frame by frame, then ~210 ms into the
//                   300-ms hop — the icon sinking into the vehicle body
//                   (B2 §6.3) + city-hop-crop.png, the G4 sheet's hop cell
//   docks-locked    a new game panned to the fogged Docks (pm:panTo): the
//                   modern port sprites as `_locked` scenery (B2 §6.4)
//   warehouse-l1    (kept; regenerated with the interior atlas)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, titleUp, type PmHelpers } from './fixtures.ts'
import {
  bayRect,
  openSheet,
  policyOff,
  roomLayout,
  sceneTarget,
  settleUntil,
  tapRoomRect,
  tapTarget,
} from './warehouse.ts'

const BASE = '/?seed=7&debug=1&mute=1'
const CITY = `${BASE}&skipTitle=1`
const POLICY = `${CITY}&policy=1`
const FIXTURE = 'tests/fixtures/late-waiting.json'

interface Pt {
  x: number
  y: number
}

const isColumn = (): boolean => test.info().project.name === 'desktop-column'
const isMinFit = (): boolean => test.info().project.name === 'min-fit'

/** iPhone-only shots; the 430×932 column takes city-30s and garage only. */
function phoneOnly(): void {
  test.skip(isColumn(), 'the 430×932 column only takes city-30s and garage')
  test.skip(isMinFit(), 'the 360×604 profile only takes the M2 shots')
}

/** M1 shots also taken in the 430×932 column (city-30s, garage). */
function phoneAndColumn(): void {
  test.skip(isMinFit(), 'the 360×604 profile only takes the M2 shots')
}

/** M2 shots: the iPhone 16 and the 360×604 minimum-fit profile. */
function phoneAndMinFit(): void {
  test.skip(isColumn(), 'the 430×932 column skips the M2 shots')
}

/** `<name>` on the phone, `-430x932` in the column, `-360x604` at min-fit. */
function shotName(name: string): string {
  if (isColumn()) return `${name}-430x932`
  return isMinFit() ? `${name}-360x604` : name
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

/**
 * A world point that the City's own tap pick (opaque sprite pixels front to
 * back, then the footprint) resolves to building `id`: its visual centre
 * when that shows, else the visible pixel nearest to it — a taller sprite
 * in front may cover a small building's middle.
 */
async function tapPointOf(page: Page, id: string): Promise<Pt> {
  const c = await buildingCentre(page, id)
  const p = await page.evaluate(
    ([bid, cx, cy]) => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        buildings: Map<string, { anchor: Pt; topY: number }>
        pick(x: number, y: number): { kind: string; view?: { id: string } }
      }
      const b = city.buildings.get(bid as string)!
      const hits = (x: number, y: number): boolean =>
        city.pick(x, y).view?.id === bid
      let best: (Pt & { d: number }) | null = null
      for (let y = b.topY; y <= b.anchor.y; y += 2)
        for (let x = b.anchor.x - 96; x <= b.anchor.x + 96; x += 2) {
          if (!hits(x, y)) continue
          const d = Math.hypot(x - (cx as number), y - (cy as number))
          if (!best || d < best.d) best = { x, y, d }
        }
      return best
    },
    [id, c.x, c.y] as const,
  )
  expect(p, `a visible pixel of ${id}`).not.toBeNull()
  return { x: p!.x, y: p!.y }
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
  name: 'warehouse' | 'garage' | 'shield',
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
    phoneAndColumn()
    await page.goto(BASE)
    // __pm.ready waits for the player's game; the Title over the attract
    // city (B2 §5) comes first. Frozen at once: the tour holds 1 s on the lot.
    await titleUp(page)
    await pm.freeze()
    await pm.shot(shotName('title'), 40)
    const st = await page.evaluate(() => {
      const api = window.__pm!
      const sm = api.game.scene
      const title = sm.getScene('Title') as unknown as {
        children: {
          list: {
            getData?(k: string): unknown
            texture: { key: string }
            visible: boolean
          }[]
        }
      }
      const logo = title.children.list.find(
        (o) => o.getData?.('id') === 'title:logo',
      )
      return {
        logo: logo ? logo.texture.key : null,
        logoVisible: logo?.visible ?? false,
        hud: sm.isActive('HUD'),
        attract: api.attractSim !== null && api.core === api.attractSim,
        vehicles: api.core.state.vehicles.length,
      }
    })
    console.log(`shots: title ${JSON.stringify(st)}`)
    expect(st).toMatchObject({
      logo: 'logo',
      logoVisible: true,
      hud: false,
      attract: true,
    })
    expect(st.vehicles).toBeGreaterThanOrEqual(4)
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
    phoneAndColumn()
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
    const centre = await tapPointOf(page, target!)
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
    phoneAndColumn()
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

// ---- M2 ------------------------------------------------------------------

const WH_POLICY = `${POLICY}&view=warehouse`

interface ShotFixture {
  text: string
  fixture: Record<string, unknown> & { regenerate: string }
}

/**
 * Freeze, check the fixture's data hash against the build's, load it
 * through __pm.load (?policy=1 re-creates the policy for the loaded sim)
 * and settle a few frames.
 */
async function loadFixture(
  page: Page,
  pm: PmHelpers,
  name: string,
): Promise<ShotFixture> {
  const path = `tests/fixtures/${name}.json`
  const text = readFileSync(path, 'utf8')
  const fx = JSON.parse(text) as {
    dataHash: string
    fixture: ShotFixture['fixture']
  }
  const hash = await page.evaluate(() => window.__pm!.data.hash)
  expect(
    fx.dataHash,
    `${path} is stale (data changed): run \`${fx.fixture.regenerate}\``,
  ).toBe(hash)
  await pm.freeze()
  await page.evaluate((json) => window.__pm!.load(json), text)
  return { text, fixture: fx.fixture }
}

/** Opening A for 60 s under the policy, in the warehouse (warehouse-l1). */
async function warehouseAt60s(page: Page, pm: PmHelpers): Promise<void> {
  await pm.open(WH_POLICY)
  await runFor(page, pm, 60_000)
  const st = await page.evaluate(() => {
    const api = window.__pm!
    const slot = (id: string): string | null =>
      api.sim.lane.nodes().find((n) => n.id === id)?.fixture?.kind ?? null
    return {
      warehouse: api.game.scene.isActive('Warehouse'),
      slot1: slot('slot1'),
      slot2: slot('slot2'),
    }
  })
  expect(st).toEqual({ warehouse: true, slot1: 'desk', slot2: 'machine' })
}

/**
 * Policy off (it Tosses every flag on the next tick), debug.forceFlagNext
 * ('metal'), then real frames at 4× until `event` fires and back to 1×:
 * every parcel the room shows has its sprite before the catch, as in play
 * (a sim-only advance would spawn the flagged sprite first and the rest of
 * the lane over it on the next frame).
 */
async function forceFlag(
  page: Page,
  event: 'parcel:flagged' | 'parcel:held',
): Promise<void> {
  await policyOff(page)
  const w = await page.evaluate((e) => {
    const api = window.__pm!
    const ev = api.core.events as unknown as {
      on(n: string, f: (p: unknown) => void): unknown
      off(n: string, f: (p: unknown) => void): unknown
    }
    const got: { payload: unknown } = { payload: null }
    const fn = (p: unknown): void => {
      got.payload ??= p
    }
    ev.on(e, fn)
    api.sim.debug!.forceFlagNext('metal')
    api.speed(4)
    const t0 = api.sim.tick
    let frames = 0
    while (got.payload === null && frames < 4000) {
      api.step(16)
      frames++
    }
    api.speed(1)
    ev.off(e, fn)
    return {
      ok: got.payload !== null,
      frames,
      simS: (api.sim.tick - t0) / 10,
      payload: got.payload,
    }
  }, event)
  console.log(`shots: forced flag ${JSON.stringify(w)}`)
  expect(w.ok, `${event} after the forced flag`).toBe(true)
}

/** The HUD's lost-life / game-over card state. */
function hudCards(page: Page): Promise<{ lost: boolean; over: boolean }> {
  return page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      lostCard: { isOpen(): boolean }
      overCard: { isOpen(): boolean }
    }
    return { lost: hud.lostCard.isOpen(), over: hud.overCard.isOpen() }
  })
}

test.describe('M2 shots', () => {
  test('warehouse-l1', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await warehouseAt60s(page, pm)
    await pm.shot(shotName('warehouse-l1'))
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('warehouse-catch', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await warehouseAt60s(page, pm)
    await pm.overlay(false)
    await pm.stamp('test')
    await forceFlag(page, 'parcel:flagged')
    // §3.3 at t + 300 ms: the flip to the dark parcel + trait icon done,
    // the workers jumping, the slide toward the chute starting.
    await pm.shot(shotName('warehouse-catch'), 19)
    expect(await page.evaluate(() => window.__pm!.sim.holdBay.count)).toBe(1)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('warehouse-holdcard', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await warehouseAt60s(page, pm)
    await forceFlag(page, 'parcel:held')
    await pm.settle(64) // the catch moment and the divert into bay 1
    await tapRoomRect(page, pm, bayRect(0))
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'hold',
      ),
      'the Hold Bay card opens',
    ).toBe(true)
    await pm.shot(shotName('warehouse-holdcard'), 30)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('warehouse-stalled', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await pm.open(WH_POLICY)
    const { fixture } = await loadFixture(page, pm, 'holdbay-full')
    // The policy would Toss the full bay on the first tick.
    await policyOff(page)
    await pm.settle(64)
    const lane = await page.evaluate(() => {
      const vs = window.__pm!.sim
      return { stalled: vs.lane.stalled, held: vs.holdBay.count }
    })
    console.log(`shots: stalled ${JSON.stringify(lane)}`)
    expect(lane.stalled?.reason).toBe('holdBayFull')
    expect(lane.stalled?.nodeId).toBe(fixture.stallNodeId)
    expect(lane.held).toBe(3)
    await pm.shot(shotName('warehouse-stalled'))
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('warehouse-buysheet', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await warehouseAt60s(page, pm)
    const slot = await page.evaluate(
      () =>
        window
          .__pm!.sim.lane.nodes()
          .find((n) => n.kind === 'slot' && !n.locked && n.fixture === null)
          ?.id ?? null,
    )
    expect(slot, 'an empty live slot').not.toBeNull()
    await tapRoomRect(page, pm, roomLayout.rectFor(slot!)!)
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'buy',
      ),
      'the BuySheet opens',
    ).toBe(true)
    await pm.shot(shotName('warehouse-buysheet'), 30)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('lost-life', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await pm.open(POLICY)
    const { fixture } = await loadFixture(page, pm, 'malware-cleared')
    await pm.settle(5)
    await focusCity(
      page,
      await buildingCentre(page, fixture.destBuildingId as string),
    )
    const capMs = ((fixture.lifeLostInS as number) + 10) * 1000
    const w = await page.evaluate(
      (cap) => window.__pm!.waitEvent('life:lost', cap),
      capMs,
    )
    console.log(
      `shots: life:lost after ${w.waitedMs} ms ${JSON.stringify(w.payload?.report ?? null)}`,
    )
    expect(w.ok, 'the cleared malware is delivered').toBe(true)
    expect(w.payload!.parcelId).toBe(fixture.parcelId)
    expect(w.payload!.clearedByPlayerAt).not.toBeNull()
    expect(
      await settleUntil(page, pm, async () => (await hudCards(page)).lost),
      'the lost-life card opens (600 ms after the loss)',
    ).toBe(true)
    await pm.shot(shotName('lost-life'), 30)
    expect(await page.evaluate(() => window.__pm!.sim.lives)).toBe(2)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('game-over', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await pm.open(POLICY)
    const { fixture } = await loadFixture(page, pm, 'one-life')
    await pm.settle(5)
    await focusCity(
      page,
      await buildingCentre(page, fixture.destBuildingId as string),
    )
    const capMs = ((fixture.gameOverInS as number) + 10) * 1000
    const w = await page.evaluate(
      (cap) => window.__pm!.waitEvent('game:over', cap),
      capMs,
    )
    expect(w.ok, 'the third malware delivery ends the game').toBe(true)
    expect(
      await settleUntil(page, pm, async () => (await hudCards(page)).over),
      'the game-over screen opens',
    ).toBe(true)
    await pm.shot(shotName('game-over'), 30)
    const st = await hudCards(page)
    expect(st).toEqual({ lost: false, over: true })
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

// ---- M3 ------------------------------------------------------------------

/** City's own warehouse-sprite centre (world px). */
function warehouseCentre(page: Page): Promise<Pt> {
  return page.evaluate(() => {
    const city = window.__pm!.game.scene.getScene('City') as unknown as {
      warehouseCentre(): Pt
    }
    return city.warehouseCentre()
  })
}

/**
 * level-up.json under ?policy=1 (3 s before its level:up), the camera on
 * `focus`, then real 16-ms frames at 1× until level:up fires (as in play:
 * the money floats and toasts of the lead-in come and go in their own time
 * instead of landing together, as a sim-only wait would make them). Every
 * timeline the level-up starts (City dust + stamp, region fade, the HUD's
 * paper hold) runs from that frame, so a shot's settle frames are 16-ms
 * steps after level:up.
 */
async function levelUpAt(
  page: Page,
  pm: PmHelpers,
  url: string,
  focus: 'warehouse' | 'industrial' | null,
): Promise<void> {
  await pm.open(url)
  const { fixture } = await loadFixture(page, pm, 'level-up')
  await pm.settle(5)
  if (focus === 'warehouse') await focusCity(page, await warehouseCentre(page))
  else if (focus === 'industrial') {
    // The chip's own pan (pm:panTo), one frame per 16 ms until it lands.
    await emit(page, 'pm:panTo', { regionId: 'industrial' })
    await pm.settle(40)
  }
  await pm.freeze()
  const capFrames = Math.ceil(
    (((fixture.levelUpInS as number) + 10) * 1000) / 16,
  )
  const w = await page.evaluate((cap) => {
    const api = window.__pm!
    const ev = api.core.events as unknown as {
      on(n: string, f: (p: { level: number }) => void): unknown
      off(n: string, f: (p: { level: number }) => void): unknown
    }
    const got: { level: number | null } = { level: null }
    const fn = (p: { level: number }): void => {
      got.level ??= p.level
    }
    ev.on('level:up', fn)
    let frames = 0
    while (got.level === null && frames < cap) {
      api.step(16)
      frames++
    }
    ev.off('level:up', fn)
    return { level: got.level, frames }
  }, capFrames)
  console.log(`shots: level:up after ${w.frames} frames`)
  expect(w.level, 'the fixture levels up to 2').toBe(2)
}

/** The HUD newspaper: the paper on screen (kind) and whether it shows. */
function paperState(
  page: Page,
): Promise<{ kind: string | null; visible: boolean; headline: string }> {
  return page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      paper: {
        current(): { kind: string; headline: string } | null
        isVisible(): boolean
      }
    }
    const c = hud.paper.current()
    return {
      kind: c?.kind ?? null,
      visible: hud.paper.isVisible(),
      headline: c?.headline ?? '',
    }
  })
}

test.describe('M3 shots', () => {
  test('level-up', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await levelUpAt(page, pm, POLICY, 'warehouse')
    // 38 frames = 608 ms: dust frame 2 (500-749 ms), the stamp rising.
    await pm.shot('level-up', 38)
    const st = await page.evaluate(() => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        construction: { start: number } | null
        time: { now: number }
      }
      const c = city.construction
      return { ms: c ? city.time.now - c.start : null }
    })
    console.log(`shots: construction at ${JSON.stringify(st)}`)
    expect(st.ms, 'the construction overlay is up').not.toBeNull()
    expect(st.ms!).toBeGreaterThanOrEqual(500)
    expect(st.ms!).toBeLessThan(750)
    expect((await paperState(page)).visible, 'no paper over the moment').toBe(
      false,
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('industrial-unlocked', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await levelUpAt(page, pm, POLICY, 'industrial')
    // 100 frames = 1.6 s: the 1-s fog cross-fade and the sign pop are done.
    await pm.shot('industrial-unlocked', 100)
    const st = await page.evaluate(() => ({
      region: window.__pm!.sim.regionState('industrial'),
      chips: (
        window.__pm!.game.scene.getScene('HUD') as unknown as {
          chips: { entry: { id: string; lockLevel: number | null } }[]
        }
      ).chips.map((c) => `${c.entry.id}:${c.entry.lockLevel ?? ''}`),
    }))
    console.log(`shots: industrial ${JSON.stringify(st)}`)
    expect(st.region).toBe('live')
    expect(st.chips).toContain('industrial:')
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('newspaper', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await levelUpAt(page, pm, POLICY, 'warehouse')
    // The paper waits for the stamp (2.4 s), then slides up for 300 ms.
    expect(
      await settleUntil(page, pm, async () => (await paperState(page)).visible),
      'the level paper comes up',
    ).toBe(true)
    await pm.shot('newspaper', 30)
    const p = await paperState(page)
    console.log(`shots: paper ${JSON.stringify(p)}`)
    expect(p).toMatchObject({ kind: 'level', visible: true })
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('shield-popover', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await levelUpAt(page, pm, POLICY, null)
    // Past the stamp; rattle counts in the Detection % from the level-up tick.
    await pm.settle(150)
    const r = await hudRect(page, 'shield')
    await pm.tap(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2))
    await pm.settle(20)
    const open = await page.evaluate(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        shield: { isOpen(): boolean } | null
      }
      return hud.shield?.isOpen() ?? false
    })
    expect(open, 'the shield popover is open').toBe(true)
    await pm.shot('shield-popover', 20)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('payroll-short', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    // No policy: it would earn money before the payday.
    await pm.open(CITY)
    const { fixture } = await loadFixture(page, pm, 'payroll-short')
    await pm.settle(5)
    const capMs = ((fixture.paydayInS as number) + 10) * 1000
    const w = await page.evaluate(
      (cap) => window.__pm!.waitEvent('payroll:short', cap),
      capMs,
    )
    expect(w.ok, 'the $0 payday runs short').toBe(true)
    expect(w.payload!.employeeIds).toEqual(fixture.unpaid)
    await pm.shot('payroll-short', 30)
    const toast = await page.evaluate(
      () =>
        (
          window.__pm!.game.scene.getScene('HUD') as unknown as {
            toast: { currentText(): string | null }
          }
        ).toast.currentText() ?? '',
    )
    console.log(`shots: payroll toast "${toast}"`)
    expect(toast).toMatch(/^Payroll short: .+ unpaid$/)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('city-10min', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    test.setTimeout(180_000)
    // ?fastForward=600 runs the policy before the first render (plan.md
    // §6.8), so no toast, popup or float of the first ten minutes is queued
    // up on the first frames as a sim-only __pm.advance would leave them.
    await pm.open(`${POLICY}&fastForward=600`)
    await pm.freeze()
    await pm.shot('city-10min', 64)
    const m = await page.evaluate(() => window.__pm!.metrics())
    console.log(
      `shots: city-10min tick ${m.tick} $${m.money} lifetime $${m.lifetimeEarned} lv ${m.level} deliveries ${m.deliveries}`,
    )
    // t = 600 s, plus the settle frames the shot renders at 1×.
    expect(m.tick).toBeGreaterThanOrEqual(6000)
    expect(m.tick).toBeLessThan(6100)
    expect(m.deliveries).toBeGreaterThan(20)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('warehouse-tier2', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await levelUpAt(page, pm, WH_POLICY, null)
    // 64 frames ≈ 1 s: the 400-ms cross-fade, then the slot-4 unroll.
    await pm.shot(shotName('warehouse-tier2'), 64)
    const st = await page.evaluate(() => {
      const api = window.__pm!
      return {
        warehouse: api.game.scene.isActive('Warehouse'),
        slots: api.sim.lane
          .nodes()
          .filter((n) => n.kind === 'slot' && !n.locked)
          .map((n) => n.id),
      }
    })
    expect(st.warehouse).toBe(true)
    expect(st.slots).toEqual(['slot1', 'slot2', 'slot3', 'slot4'])
    expect((await paperState(page)).visible, 'no paper over the room').toBe(
      false,
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('warehouse-l2', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await pm.open(WH_POLICY)
    const { fixture } = await loadFixture(page, pm, 'l2-lane')
    await pm.settle(64)
    const st = await page.evaluate((slot) => {
      const api = window.__pm!
      const f = api.sim.lane.nodes().find((n) => n.id === slot)?.fixture
      return {
        warehouse: api.game.scene.isActive('Warehouse'),
        level: api.sim.level,
        shaker: f?.kind === 'machine' ? f.checker.defId : null,
      }
    }, fixture.shakerSlot as string)
    expect(st).toEqual({ warehouse: true, level: 2, shaker: 'shaky_shaker' })
    await pm.shot(shotName('warehouse-l2'))
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

// ---- M4 ------------------------------------------------------------------

/** The committed playtest.json format example (plan.md §12.7 task 1). */
const PLAYTEST_EXAMPLE = 'tests/playtest/seed-7.json'
/** The automated run's length in sim seconds (12 minutes). */
const PLAYTEST_RUN_S = 720

interface SummaryState {
  open: boolean
  mode: string | null
  title: string | null
  checks: { n: number; state: string; detail: string }[]
  paused: boolean
  overOpen: boolean
}

/** The HUD's summary card as the player sees it. */
function summaryState(page: Page): Promise<SummaryState> {
  return page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      summary: {
        isOpen(): boolean
        currentMode: string
        current: { seed: number; elapsedS: number } | null
        checks(): { n: number; state: string; detail: string }[] | null
        text(): string | null
      }
      overCard: { isOpen(): boolean }
    }
    const sc = hud.summary
    return {
      open: sc.isOpen(),
      mode: sc.isOpen() ? sc.currentMode : null,
      title: sc.text()?.split('\n')[0] ?? null,
      checks: sc.checks() ?? [],
      paused: window.__pm!.stepper.paused,
      overOpen: hud.overCard.isOpen(),
    }
  })
}

/** Wait (real time) until the sim reaches `s` sim seconds. */
async function untilSimS(
  page: Page,
  s: number,
  timeout: number,
): Promise<void> {
  await page.waitForFunction((t) => window.__pm!.core.state.tick >= t * 10, s, {
    timeout,
    polling: 100,
  })
}

/**
 * ❚❚ (pause), ❚❚ again (the pause menu: the Paused card), then `End run —
 * show summary` — real taps; `settle` lets the frames run between them.
 */
async function openSummaryByTaps(
  page: Page,
  pm: PmHelpers,
  settle: () => Promise<void>,
): Promise<void> {
  await tapTarget(page, pm, 'HUD', 'speed:0')
  await settle()
  await tapTarget(page, pm, 'HUD', 'speed:0')
  await settle()
  const menu = await page.evaluate(() =>
    (
      window.__pm!.game.scene.getScene('HUD') as unknown as {
        paused: { isOpen(): boolean }
      }
    ).paused.isOpen(),
  )
  expect(menu, '❚❚ while paused opens the pause menu').toBe(true)
  await tapTarget(page, pm, 'HUD', 'paused:summary')
  await settle()
  const st = await summaryState(page)
  expect(st.open, '`End run — show summary` opens the card').toBe(true)
  expect(st.paused, 'the summary card holds the sim').toBe(true)
}

test.describe('M4 shots', () => {
  test('playtest-12min', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    test.setTimeout(420_000)
    await pm.open(POLICY)
    // Real time at 4× (debug speed): 12 sim minutes in ~3 wall minutes.
    await page.evaluate(() => window.__pm!.speed(4))
    await untilSimS(page, 300, 150_000)
    await page.evaluate(() => window.__pm!.goto('warehouse'))
    await untilSimS(page, 360, 60_000)
    await page.evaluate(() => window.__pm!.goto('city'))
    await untilSimS(page, PLAYTEST_RUN_S - 4, 150_000)
    await page.evaluate(() => window.__pm!.speed(1))
    await untilSimS(page, PLAYTEST_RUN_S, 30_000)
    await openSummaryByTaps(page, pm, () => page.waitForTimeout(250))
    const pt = await page.evaluate(() => window.__pm!.playtest())
    expect(pt, '__pm.playtest() returns the live profile').not.toBeNull()
    mkdirSync(dirname(PLAYTEST_EXAMPLE), { recursive: true })
    writeFileSync(PLAYTEST_EXAMPLE, JSON.stringify(pt, null, 2) + '\n')
    const p = pt!
    console.log(
      `shots: playtest seed ${p.seed} simS ${p.simS} elapsedS ${p.elapsedS} pausedS ${p.pausedS} ` +
        `fps p50 ${p.fps.p50} p5 ${p.fps.p5} min ${p.fps.min} (${p.fps.samples}) taps ${p.taps} ` +
        `views ${p.viewSwitches} warehouseS ${p.warehouseS} deliveries ${p.deliveries.total} ` +
        `firstDelivery ${p.firstDeliveryS} caught ${p.firstMalware.caughtS} by ${p.firstMalware.by}`,
    )
    expect(p.seed).toBe(7)
    expect(p.simS).toBeGreaterThanOrEqual(PLAYTEST_RUN_S)
    expect(p.moneyPerMin.length).toBe(Math.floor(p.simS / 60))
    expect(p.viewSwitches).toBeGreaterThanOrEqual(2)
    expect(p.warehouseS).toBeGreaterThanOrEqual(50)
    expect(p.warehouseS).toBeLessThanOrEqual(80)
    expect(p.taps).toBeGreaterThanOrEqual(3)
    expect(p.fps.samples).toBeGreaterThan(30)
    expect(p.firstDeliveryS).not.toBeNull()
    const st = await summaryState(page)
    // The card shows elapsedS as of its opening (the recorder's
    // summaryOpenedS, the same frame); the wall clock runs on until
    // playtest() is read, so p.elapsedS can be a second further.
    const shown = await page.evaluate(
      (fallback) =>
        (
          window.__pm!.game.registry.get('playtest') as
            | { summaryOpenedS: number | null }
            | undefined
        )?.summaryOpenedS ?? fallback,
      p.elapsedS,
    )
    expect(st.title).toBe(
      `Run summary — seed 7 — ${Math.floor(shown / 60)}:${String(Math.floor(shown % 60)).padStart(2, '0')} played`,
    )
    expect(st.checks.map((c) => c.n)).toEqual([1, 2, 3, 4, 5])
    await pm.shot('summary-card', 20)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('summary-card', async ({ page, pm, consoleErrors }) => {
    test.skip(!isMinFit(), 'the iPhone shot comes from playtest-12min')
    await pm.open(POLICY)
    await runFor(page, pm, 600_000)
    await openSummaryByTaps(page, pm, () => pm.settle(8))
    await pm.shot(shotName('summary-card'), 20)
    // Fits 360×604: every button live and inside the canvas.
    const L = await page.evaluate(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        L: { W: number; H: number }
      }
      return { W: hud.L.W, H: hud.L.H }
    })
    expect(L).toEqual({ W: 360, H: 604 })
    for (const id of [
      'summary:download',
      'summary:copy',
      'summary:keep',
      'summary:newGame',
    ]) {
      const r = await sceneTarget(page, 'HUD', id)
      expect(r, `${id} is live`).not.toBeNull()
      expect(r!.x, `${id} x`).toBeGreaterThanOrEqual(0)
      expect(r!.y, `${id} y`).toBeGreaterThanOrEqual(0)
      expect(r!.x + r!.w, `${id} right`).toBeLessThanOrEqual(L.W)
      expect(r!.y + r!.h, `${id} bottom`).toBeLessThanOrEqual(L.H)
    }
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('summary-over', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(POLICY)
    const { fixture } = await loadFixture(page, pm, 'one-life')
    await pm.settle(5)
    const capMs = ((fixture.gameOverInS as number) + 10) * 1000
    const w = await page.evaluate(
      (cap) => window.__pm!.waitEvent('game:over', cap),
      capMs,
    )
    expect(w.ok, 'the third malware delivery ends the game').toBe(true)
    expect(
      await settleUntil(page, pm, async () => (await hudCards(page)).over),
      'the game-over screen opens',
    ).toBe(true)
    await pm.settle(4)
    await tapTarget(page, pm, 'HUD', 'gameOver:summary')
    await pm.settle(8)
    let st = await summaryState(page)
    expect(st).toMatchObject({ open: true, mode: 'over', overOpen: false })
    const pt = await page.evaluate(() => window.__pm!.playtest())
    expect(pt!.livesLost.length).toBeGreaterThanOrEqual(1)
    await tapTarget(page, pm, 'HUD', 'summary:back')
    await pm.settle(8)
    st = await summaryState(page)
    expect(st).toMatchObject({ open: false, overOpen: true, paused: true })
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

// ---- M5 ------------------------------------------------------------------

test.describe('M5 shots', () => {
  test('city-lot-zoom2', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(CITY)
    await pm.freeze()
    // The lot footprint's iso corners (iso.ts: tile centre = ox + (tx −
    // ty)·32, (tx + ty)·16; the diamond's vertices ±32 / ±16 from it).
    const info = await page.evaluate(() => {
      const api = window.__pm!
      const city = api.game.scene.getScene('City') as unknown as {
        ox: number
        rig: { zoomAt(z: 1 | 2, px: number, py: number): void }
        focusOn(x: number, y: number, ms: number): void
      }
      const wh = api.data.map.lot.warehouse
      const [tx, ty] = wh.tile
      const x1 = tx + wh.footprint[0] - 1
      const y1 = ty + wh.footprint[1] - 1
      const at = (a: number, b: number): { x: number; y: number } => ({
        x: city.ox + (a - b) * 32,
        y: (a + b) * 16,
      })
      const n = at(tx, ty)
      const e = at(x1, ty)
      const s = at(x1, y1)
      const w = at(tx, y1)
      const corners = {
        n: { x: n.x, y: n.y - 16 },
        e: { x: e.x + 32, y: e.y },
        s: { x: s.x, y: s.y + 16 },
        w: { x: w.x - 32, y: w.y },
      }
      const { width: W, height: H } = api.game.scale
      city.rig.zoomAt(2, Math.round(W / 2), Math.round(H / 2))
      // A zoom-2 phone frame is ~196 world px wide (the diamond is 256):
      // centre just above the front (S) vertex, so both front edges run
      // out of it — the walls hide the back half of the slab anyway.
      city.focusOn(corners.s.x, corners.s.y - 40, 0)
      return { corners, on: api.debugLotCorners(true) }
    })
    await pm.settle(10)
    const screen: Record<string, Pt> = {}
    for (const [k, c] of Object.entries(info.corners))
      screen[k] = await cityScreen(page, c)
    console.log(
      `shots: city-lot-zoom2 lot corners world ${JSON.stringify(info.corners)} → screen ${JSON.stringify(screen)}`,
    )
    expect(info.on, '__pm.debugLotCorners(true) drew the marks').toBe(true)
    expect(
      await page.evaluate(
        () => window.__pm!.game.scene.getScene('City').cameras.main.zoom,
      ),
    ).toBe(2)
    await pm.shot('city-lot-zoom2', 10)
    expect(await page.evaluate(() => window.__pm!.debugLotCorners(false))).toBe(
      false,
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('city-bike', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(POLICY)
    await runFor(page, pm, 40_000)
    const id = await page.evaluate(
      () =>
        window.__pm!.sim.vehicles.find((v) => v.type === 'bike')?.id ?? null,
    )
    expect(id, 'the policy owns a bike').not.toBeNull()
    await page.evaluate((vid) => {
      const api = window.__pm!
      const city = api.game.scene.getScene('City') as unknown as {
        rig: { zoomAt(z: 1 | 2, px: number, py: number): void }
      }
      const { width: W, height: H } = api.game.scale
      city.rig.zoomAt(2, Math.round(W / 2), Math.round(H / 2))
      api.game.events.emit('pm:follow', { vehicleId: vid })
    }, id!)
    // shot(…, 0) renders no frame of its own: hide the overlay and stamp now.
    await pm.overlay(false)
    await pm.stamp('test')
    await pm.settle(60)
    // Ride on until nothing drawn in front of the bike (a building, the
    // warehouse, a prop) overlaps its sprite, so the courier reads whole.
    const clearAfter = await page.evaluate(
      ({ vid, capFrames }) => {
        const api = window.__pm!
        type Img = {
          depth: number
          visible: boolean
          getBounds(): { x: number; y: number; width: number; height: number }
        }
        const city = api.game.scene.getScene('City') as unknown as {
          buildings: Map<string, { image: Img | null }>
          props: { img: Img | null }[]
          warehouse: Img | null
          vehicles: Map<number, { img: Img }>
        }
        const overlaps = (a: Img, b: Img): boolean => {
          const p = a.getBounds()
          const q = b.getBounds()
          return (
            p.x < q.x + q.width &&
            q.x < p.x + p.width &&
            p.y < q.y + q.height &&
            q.y < p.y + p.height
          )
        }
        const clear = (): boolean => {
          const v = city.vehicles.get(vid)
          if (!v) return false
          const front = [
            ...[...city.buildings.values()].map((b) => b.image),
            ...city.props.map((pr) => pr.img),
            city.warehouse,
          ]
          return front.every(
            (o) =>
              !o || !o.visible || o.depth < v.img.depth || !overlaps(o, v.img),
          )
        }
        for (let f = 0; f < capFrames; f++) {
          if (clear()) return f
          api.step(16)
        }
        return null
      },
      { vid: id!, capFrames: 3000 },
    )
    console.log(
      `shots: city-bike clear of occluders after ${clearAfter} frames`,
    )
    const st = await page.evaluate((vid) => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        followId: number | null
        vehicles: Map<
          number,
          { x: number; y: number; img: { frame: { name: string } } }
        >
        cameras: {
          main: {
            zoom: number
            worldView: { contains(x: number, y: number): boolean }
          }
        }
      }
      const v = city.vehicles.get(vid)
      const cam = city.cameras.main
      return {
        zoom: cam.zoom,
        followId: city.followId,
        onScreen: v ? cam.worldView.contains(v.x, v.y) : false,
        frame: v?.img.frame.name ?? null,
      }
    }, id!)
    console.log(`shots: city-bike ${JSON.stringify(st)}`)
    expect(st.zoom).toBe(2)
    expect(st.followId).toBe(id)
    expect(st.onScreen, 'the bike is in view').toBe(true)
    expect(st.frame ?? '').toMatch(/^bike_/)
    await pm.shot('city-bike', 0)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('city-hop', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    test.setTimeout(180_000)
    await pm.open(POLICY)
    // The policy buys a bike in the first seconds: follow it at zoom 2 (a
    // hop off screen is never spawned) and render every frame up to its
    // first pickup, so the view (and so the hop's end point) is current.
    await runFor(page, pm, 5_000)
    const id = await page.evaluate(
      () =>
        window.__pm!.sim.vehicles.find((v) => v.type === 'bike')?.id ?? null,
    )
    expect(id, 'the policy owns a bike').not.toBeNull()
    await page.evaluate((vid) => {
      const api = window.__pm!
      const city = api.game.scene.getScene('City') as unknown as {
        rig: { zoomAt(z: 1 | 2, px: number, py: number): void }
      }
      const { width: W, height: H } = api.game.scale
      city.rig.zoomAt(2, Math.round(W / 2), Math.round(H / 2))
      api.game.events.emit('pm:follow', { vehicleId: vid })
    }, id!)
    // shot(…, 0) renders no frame of its own: hide the overlay and stamp now.
    await pm.overlay(false)
    await pm.stamp('test')
    await pm.settle(30)
    const hop = await page.evaluate(
      ({ vid, capFrames, sinkFrames }) => {
        const api = window.__pm!
        type HopSlot = {
          kind: string | null
          sink: boolean
          age: number
          side: number
          x1: number
          y1: number
          container: { x: number; y: number }
        }
        const city = api.game.scene.getScene('City') as unknown as {
          popups: { slots: HopSlot[] }
        }
        const ev = api.core.events as unknown as {
          on(n: string, f: (pl: { vehicleId: number }) => void): unknown
          off(n: string, f: (pl: { vehicleId: number }) => void): unknown
        }
        const got = { picked: false }
        const fn = (pl: { vehicleId: number }): void => {
          if (pl.vehicleId === vid) got.picked = true
        }
        ev.on('parcel:pickedUp', fn)
        let frames = 0
        while (!got.picked && frames < capFrames) {
          api.step(16)
          frames++
        }
        ev.off('parcel:pickedUp', fn)
        const s = city.popups.slots.find((x) => x.kind === 'hop' && x.sink)
        const picked = got.picked
        if (!picked || !s) return { picked, frames, slot: false }
        for (let i = 0; i < sinkFrames; i++) api.step(16)
        return {
          picked,
          frames,
          slot: true,
          age: s.age,
          side: s.side,
          end: { x: s.x1, y: s.y1 },
          at: { x: s.container.x, y: s.container.y },
        }
      },
      // ~210 ms into the 300-ms hop (the spawn frame + 12): k ≈ 0.7, a
      // quarter into the sink (the icon cropped to ~12 of its 16 px).
      { vid: id!, capFrames: 6000, sinkFrames: 12 },
    )
    console.log(`shots: city-hop ${JSON.stringify(hop)}`)
    expect(hop.picked, 'the bike picked a parcel up').toBe(true)
    expect(hop.slot, 'a sinking pickup hop is in flight').toBe(true)
    expect(hop.side, 'the icon is shrinking').toBeLessThan(16)
    expect(hop.side, 'the icon is still visible').toBeGreaterThan(0)
    const end = await cityScreen(page, hop.end ?? { x: 0, y: 0 })
    console.log(`shots: city-hop end point on screen ${JSON.stringify(end)}`)
    const path = await pm.shot('city-hop', 0)
    // The G4 sheet's hop cell (`node tools/art/contact.ts fixes --hop
    // shots/city-hop-crop.png`): 96×64 logical px around the end point.
    const clip = await page.evaluate((p) => {
      const game = window.__pm!.game
      const r = game.canvas.getBoundingClientRect()
      const z = game.scale.zoom
      return {
        x: r.left + (p.x - 48) * z,
        y: r.top + (p.y - 38) * z,
        width: 96 * z,
        height: 64 * z,
      }
    }, end)
    await page.screenshot({
      path: path.replace(/\.png$/, '-crop.png'),
      clip,
      scale: 'device',
    })
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('docks-locked', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(CITY)
    await pm.freeze()
    expect(
      await page.evaluate(() => window.__pm!.sim.regionState('docks')),
    ).toBe('locked')
    await emit(page, 'pm:panTo', { regionId: 'docks' })
    await pm.settle(40) // the 350-ms pan
    const frames = await page.evaluate(() => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        byDistrict: Map<
          string,
          { id: string; image: { frame: { name: string } } | null }[]
        >
      }
      return (city.byDistrict.get('docks') ?? []).map(
        (v) => `${v.id}:${v.image?.frame.name ?? '-'}`,
      )
    })
    console.log(`shots: docks-locked frames ${frames.join(' ')}`)
    expect(frames.length).toBeGreaterThan(0)
    await pm.shot('docks-locked', 10)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})
