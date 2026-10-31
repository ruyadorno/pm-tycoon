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
// M4 (plan.md §12.7 tasks 1-2, §12.9; M10 v2, plan-build2 §8.7 tasks 1-2):
//   playtest-35min  iPhone 16: the 35-minute automated run (seed 7, policy):
//                   the first 6:00 in real time at 4× — the recorder's wall
//                   clock, fps sampler and pause clock see a real session;
//                   5:00-6:00 in the Warehouse — then fast-forwarded in
//                   20-s __pm.advance chunks with real frames between them
//                   (the HUD's recorder hears every sim event: hires,
//                   quests, hand-offs), the last 4 s at 1× — then ❚❚, ❚❚
//                   again (the pause menu) and `End run — show summary` by
//                   real taps: the `summary-card` shot (the v2 rows + fun
//                   bar 2), and the profile written to
//                   tests/playtest/seed-7.json (the committed format example;
//                   tests/metrics/playtest-schema.test.ts validates it)
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
//
// M6 (plan-build2 §8.3 task 12; design-m6 §6, §7 "Shots (G)"):
//   hire-sheet            a new game in the room: the desk card's [Hire
//                         inspector] by real taps → the HireSheet with three
//                         inspector cards (+ `-360x604`: every card inside
//                         the canvas)
//   garage-driver-picker  a new game: the Garage's Bike buy card → `Who
//                         drives the Bike?` (three driver cards, Post an ad,
//                         Hire later)
//   warehouse-two-desks   people-l3.json, no policy (L3 — real since M8,
//                         by debug.forceLevel before —, desk 2 in slot 3
//                         with a charisma-2 inspector):
//                         both desks staffed, both in the readout; then
//                         warehouse-desk2-card (desk 2's card, its rows)
//   station-sorter        sorter-duty.json, no policy: the sorter on duty at
//                         the Hold Bay station, the rack lamp's S badge; then
//                         station-card (the StationCard on duty)
//   holdcard-sorter-hint  sorter-duty.json: the tagged parcel's bay tapped →
//                         the Hold Bay card with the record's `holdCardLine`
//                         (`Mo: looks clean (85%)` — the fixture's sorter,
//                         not the plan's Pat) (+ `-360x604`)
// tools/fixtures/people.ts writes both fixtures (same staleness rule).
//
// M7 (plan-build2 §8.4 task 8; design-m7 §6.3-§6.8, §7 "e2e/shots.spec.ts"):
//   quest-offer           ?quest=rush_district on a new game (Boot's debug
//                         offer, its card opened at create), 20 s of a
//                         player-less city behind it (waiting badges): the
//                         JOB BOARD card, Accept · Later · Decline
//                         (+ `-360x604`: the card inside the canvas, above
//                         the bottom bar)
//   quest-chip            policy, ?fastForward=720 (L2 at ~11.9 min on
//                         seed 7), the quest it holds abandoned, then
//                         debug rush_district on the busiest district (L2
//                         goal 10): frozen at its 4th delivery — the chip
//                         `4/10 · 1d 19h` in row B (the plan's `1d 12h`
//                         is not reached: a forced-L2 game from tick 0
//                         times out at 2/10), the level bar short
//   magic-parcel          policy 40 s, debug.offerQuest('magic_parcel') +
//                         Accept: frozen while the golden parcel waits at A,
//                         the camera between A and B — `ic_magic` + the
//                         countdown ring over both
//   quest-complete        the same magic quest followed in real frames (4×)
//                         from its outbound load to the delivery at B: the
//                         gold `QUEST COMPLETE +1 life +$150` stamp mid-rise
//                         at the money cell, the 4th bomb slot lit
//   district-panel-quest  ?policy=1&quest=rush_district, 30 s: the target
//                         district's panel with its quest row
//                         (`Rush hour · n/6 · 2d …h`)
//   victory-card          policy, ?fastForward=600 (a 10-minute run for
//                         the card's stats), the quest it holds abandoned,
//                         the Golden Release by debug (debugQuest +
//                         finishUltimate: its counters set to the goal),
//                         the VictoryCard after the stamp
//                         (+ `-360x604`: its buttons inside the canvas)
//
// M8 (plan-build2 §8.5 tasks 9-10; design-m8-m9 §6.1-§6.3, §8 lane G),
// fixtures from `node tools/fixtures/m8.ts`:
//   title                  re-taken over the L3 attract city (≥ 6 vehicles
//                          incl. a van and two trucks, the Docks live)
//   level-up-3             level-up-3.json + policy, camera on the
//                          warehouse, frozen on dust frame 2 (500-749 ms
//                          after level:up {3}) with the LEVEL stamp
//   docks-live             level-up-3.json + policy, the chip's pan to the
//                          Docks, after the 1-s fog cross-fade: the modern
//                          port sprites in colour (B2 §6.4)
//   warehouse-tier3        level-up-3.json + policy in the room: level:up
//                          while inside → the tier-3 cross-fade settled
//                          (green floor, brick, 20 × 5 shelf, props_t3)
//                          (+ `-360x604`)
//   warehouse-two-docks    l3-docks.json + policy in the room, real frames
//                          at 4× until both docks hold a vehicle: two doors
//                          open, two tails, dock 2's roller pad, the panel's
//                          lamp column (+ `-360x604`)
//   warehouse-dock-dialog  level-up-3.json + policy past the level-up: dock
//                          2's door tapped → `Loading dock 2` · `$800 · a
//                          second door into slot 1` · `Buy $800`
//   clearance-ring         l3-docks.json + policy at zoom 2 on the port
//                          office, the fixture clearance 20 s out: ring_4
//                          or so over the office (B2 §4.1)
//   ship-departure         l3-docks.json + policy, sim-only to the fixture
//                          clearance's hub:departure, then 2 s of frames:
//                          the ship 2 s into its 4-s sail west
//   lost-life-overseas     overseas-malware.json + policy, camera on the
//                          pier, sim-only to life:lost: the card's route
//                          ends `Handed off at Prefetch Pier 1 …` / `Cleared
//                          … — the ship has sailed` (+ `-360x604`)
//
// M9 (plan-build2 §8.6 task 7 + acceptance; design-m8-m9 §6.1-§6.3, §8 lane
// G), fixtures from `node tools/fixtures/m9.ts` (l3-docks.json is at a real
// L4 since M9: warehouse-two-docks shows tier 4 with dock 3 for sale):
//   title                  re-taken over the L5 attract city (the first
//                          whole minute in 24-30 with a van and two trucks)
//   lowres-live            level-up-4.json + policy, the chip's pan to
//   rural-live             Low-density / Rural, after the 1-s fog
//                          cross-fade of both L4 regions: in colour
//   level-up-5             level-up-5.json + policy, camera on the
//                          warehouse, frozen on dust frame 2 of level:up {5}
//                          (no `coming soon` anywhere in the HUD)
//   airport-live           level-up-5.json + policy, the pan to the Airport
//   civic-live             / Park & civic after the cross-fade: in colour
//                          (the Airport label sits at (41, 10) since the M9
//                          integration, so the pan frames the plane at its
//                          stand, the terminal, the tower and the hangar's
//                          door; the civic fountain at (22, 41))
//   warehouse-tier4        l4-room.json + policy in the room, scrolled 0:
//                          tier 4, 16 rows, slots 1-5, the slot-6 strip
//                          (iPhone 16 393×659: maxScroll 9; `-360x604`:
//                          maxScroll 64 — the plan's warehouse-tier4-360)
//   warehouse-tier5        level-up-5.json + policy in the room: level:up
//                          {5} while inside → the hard re-layout (R21) under
//                          the fade, settled at scroll 0: tier 5, 18 rows,
//                          slot 6 (+ `-360x604`: maxScroll 128); then
//                          warehouse-tier5-scrolled at maxScroll (the shelf
//                          and bin, the readout still fixed, R10)
//   golden-release-offer   l5-tycoon.json WITHOUT the policy: the regular
//                          quest it holds abandoned, the gold chip tapped →
//                          the Golden Release card, Accept · Later
//                          (+ `-360x604`: inside the canvas)
//   plane-departure        l5-tycoon.json + policy, sim-only to the first
//                          hub:departure {airport}, then 160 frames (2.56 s,
//                          t ≈ 0.64 of the 4-s leg): the plane climbing at
//                          full opacity east of its stand
//   victory                victory.json + policy, real frames to its
//                          game:victory, the VictoryCard after the stamp —
//                          the real Golden Release of seed 7's run
//                          (+ `-360x604`)
//   title-tycoon           victory.json + policy to game:victory (the HUD
//                          saves at once), then the Title: Continue
//                          `Day … · $… · Tycoon ✓` (+ `-360x604`: the line
//                          inside the button, `Lv 5` dropped if too wide)
// Every M9 shot but title-tycoon marks the page's one-time hints done after
// the load (quietHints: the tour skipped, the first-flag funnel, the
// first-Toss hint and the 30-minute summary offer seen), so no toast covers
// the M9 art.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Page } from '@playwright/test'
import {
  debugQuest,
  expect,
  finishUltimate,
  questUi,
  test,
  titleUp,
  type PmHelpers,
} from './fixtures.ts'
import {
  bayRect,
  dockHit,
  expectRoomScrolls,
  hireSheet,
  openSheet,
  policyOff,
  roomFit,
  roomLayout,
  roomScrollTo,
  sceneTarget,
  sceneTexts,
  settleUntil,
  SORTER_STAND,
  tapRoomRect,
  tapStation,
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
        level: api.core.state.level.level,
        docks: api.core.state.districts['docks']?.live ? 'live' : 'locked',
      }
    })
    console.log(`shots: title ${JSON.stringify(st)}`)
    expect(st).toMatchObject({
      logo: 'logo',
      logoVisible: true,
      hud: false,
      attract: true,
      docks: 'live',
    })
    // M8: the L3 attract city (tools/fixtures/attract.ts).
    expect(st.level).toBeGreaterThanOrEqual(3)
    expect(st.vehicles).toBeGreaterThanOrEqual(6)
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
    // ~4 min: the opening bike, a day of payroll paid, its driver row (the
    // second bike comes at ~4.5 min, price + $50 — the same at M5).
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
    const lost = w.payload
    // Build 3: the parcel variant (an event's life has no parcel).
    if (lost?.cause === 'event') throw new Error('an event took the life')
    expect(lost!.parcelId).toBe(fixture.parcelId)
    expect(lost!.clearedByPlayerAt).not.toBeNull()
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
  focus:
    | 'warehouse'
    | 'industrial'
    | 'docks'
    | 'lowres'
    | 'rural'
    | 'airport'
    | 'civic'
    | null,
  name: 'level-up' | 'level-up-3' | 'level-up-4' | 'level-up-5' = 'level-up',
  level = 2,
  quiet = false,
): Promise<void> {
  await pm.open(url)
  const { fixture } = await loadFixture(page, pm, name)
  await pm.settle(5)
  if (quiet) await quietHints(page)
  if (focus === 'warehouse') await focusCity(page, await warehouseCentre(page))
  else if (focus !== null) {
    // The chip's own pan (pm:panTo), one frame per 16 ms until it lands.
    await emit(page, 'pm:panTo', { regionId: focus })
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
  console.log(`shots: ${name} level:up after ${w.frames} frames`)
  expect(w.level, `the fixture levels up to ${level}`).toBe(level)
}

/**
 * M9 shots: the one-time hints a fresh page would raise over a loaded
 * mid-game fixture are marked done, as a player of that run has seen them —
 * the tour skipped (its Skip tour), the first-flag funnel and the first-Toss
 * hint seen (the policy Tosses as the player) and the 30-minute summary offer
 * made (victory.json is past 30:00) — and any toast up is cleared, so nothing
 * covers the M9 art. Every
 * other HUD reaction (level stamp, paper, chips, quest UI) is untouched.
 */
async function quietHints(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = window.__pm!
    type Seen = { sawFirstFlag: boolean; sawTossHint: boolean }
    const hud = api.game.scene.getScene('HUD') as unknown as {
      onboarding: { skipTour(): void; state: Seen }
      recorder: { offered: boolean; markOffered(): void }
      toast: { clear(): void }
    }
    hud.onboarding.skipTour()
    const ob = api.game.registry.get('onboarding') as Seen | null
    for (const s of [hud.onboarding.state, ob])
      if (s) {
        s.sawFirstFlag = true
        s.sawTossHint = true
      }
    if (!hud.recorder.offered) hud.recorder.markOffered()
    hud.toast.clear()
  })
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
/** The automated run's length in sim seconds (35 minutes, plan-build2 §8.7 task 1). */
const PLAYTEST_RUN_S = 2100
/** Sim ms per __pm.advance chunk while the run is fast-forwarded. */
const PLAYTEST_FF_CHUNK_MS = 20_000

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

/** The HUD's cards, holds and quest slots (summary-flow diagnostics). */
function hudDiag(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const api = window.__pm!
    const h = api.game.scene.getScene('HUD') as unknown as {
      paused: { isOpen(): boolean }
      holds: Set<string>
      modalDepth(): number
      lostCard: { isOpen(): boolean }
      toast: { currentText(): string | null }
      questCard: { isOpen: boolean; mode: string | null }
      victoryCard: { isOpen: boolean }
      summary: { isOpen(): boolean }
      district: { isOpen(): boolean } | null
      paper: { isVisible(): boolean }
    }
    const qs = api.quests()
    return {
      menu: h.paused.isOpen(),
      tick: api.sim.tick,
      speed: api.stepper.speed,
      paused: api.stepper.paused,
      holds: [...h.holds],
      modals: h.modalDepth(),
      lostCard: h.lostCard.isOpen(),
      questCard: h.questCard.isOpen ? h.questCard.mode : null,
      victoryCard: h.victoryCard.isOpen,
      summary: h.summary.isOpen(),
      district: h.district?.isOpen() ?? false,
      paper: h.paper.isVisible(),
      garage: api.game.scene.isActive('Garage'),
      toast: h.toast.currentText(),
      offer: qs.offer?.templateId ?? null,
      active: qs.active?.templateId ?? null,
      last: qs.history.at(-1)?.outcome ?? null,
    }
  })
}

/** A newspaper on screen or waiting in the HUD's queue. */
function paperPending(
  page: Page,
): Promise<{ visible: boolean; queued: number }> {
  return page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      paper: {
        isVisible(): boolean
        queue: { current: unknown; waiting: unknown[] }
      }
    }
    const q = hud.paper.queue
    return {
      visible: hud.paper.isVisible(),
      queued: (q.current !== null ? 1 : 0) + q.waiting.length,
    }
  })
}

/**
 * The paper's OK target once its 300-ms slide has landed (two equal reads
 * 100 ms apart): a rect read mid-slide sits lower, and its centre can fall
 * on the bottom bar's Garage button (which draws over the sliding paper).
 */
async function restingPaperOk(page: Page): Promise<boolean> {
  let prev: { x: number; y: number } | null = null
  for (let i = 0; i < 40; i++) {
    const r = await sceneTarget(page, 'HUD', 'newspaper:ok')
    if (r && prev && r.x === prev.x && r.y === prev.y) return true
    prev = r
    await page.waitForTimeout(100)
  }
  return false
}

/**
 * M7: close what quests leave over the bottom bar before the ❚❚ taps — by
 * real taps, as a player would. A QuestCard (OK / Close / Later by its
 * mode) if one is up (a guard: the HUD never auto-opens one while the
 * policy drives the stepper); then every newspaper (OK), once its slide
 * has landed,
 * until none is up or queued: the level / region / quest papers (seed 7
 * reaches L5 at ~27.9 min) can sit over the bottom bar when the automated
 * run ends.
 */
async function dismissQuestUi(
  page: Page,
  pm: PmHelpers,
  settle: () => Promise<void>,
): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const card = (await questUi(page)).card
    if (card.open) {
      const name =
        card.mode === 'complete'
          ? 'ok'
          : card.mode === 'active'
            ? 'close'
            : 'later'
      await tapTarget(page, pm, 'HUD', `quest:${name}`)
      await settle()
      continue
    }
    const st = await paperPending(page)
    if (!st.visible && st.queued === 0) return
    if (
      st.visible &&
      (await restingPaperOk(page)) &&
      (await paperPending(page)).visible
    )
      await tapTarget(page, pm, 'HUD', 'newspaper:ok')
    await settle()
  }
  expect((await questUi(page)).card.open, 'no QuestCard left up').toBe(false)
  expect((await paperPending(page)).visible, 'no newspaper left up').toBe(false)
}

/**
 * ❚❚ (pause), ❚❚ again (the pause menu: the Paused card), then `End run —
 * show summary` — real taps; `settle` lets the frames run between them.
 * An open QuestCard and any newspaper are closed first (dismissQuestUi).
 */
async function openSummaryByTaps(
  page: Page,
  pm: PmHelpers,
  settle: () => Promise<void>,
): Promise<void> {
  console.log(
    `shots: before the summary taps ${JSON.stringify(await hudDiag(page))}`,
  )
  await dismissQuestUi(page, pm, settle)
  await tapTarget(page, pm, 'HUD', 'speed:0')
  await settle()
  await tapTarget(page, pm, 'HUD', 'speed:0')
  await settle()
  const hud = await hudDiag(page)
  console.log(`shots: pause menu ${JSON.stringify(hud)}`)
  expect(hud.menu, '❚❚ while paused opens the pause menu').toBe(true)
  await tapTarget(page, pm, 'HUD', 'paused:summary')
  await settle()
  const st = await summaryState(page)
  expect(st.open, '`End run — show summary` opens the card').toBe(true)
  expect(st.paused, 'the summary card holds the sim').toBe(true)
}

test.describe('M4 shots', () => {
  test('playtest-35min', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    test.setTimeout(600_000)
    await pm.open(POLICY)
    // Real time at 4× (debug speed) for the first 6 sim minutes.
    await page.evaluate(() => window.__pm!.speed(4))
    await untilSimS(page, 300, 150_000)
    await page.evaluate(() => window.__pm!.goto('warehouse'))
    await untilSimS(page, 360, 60_000)
    await page.evaluate(() => window.__pm!.goto('city'))
    // The HUD (and the recorder's warehouseS) follow the awake view a few
    // frames later: wait for it before ticking the sim in big chunks.
    await page.waitForFunction(
      () =>
        (
          window.__pm!.game.scene.getScene('HUD') as unknown as {
            view: string
          }
        ).view === 'city',
      undefined,
      { timeout: 10_000, polling: 50 },
    )
    // Fast-forward to 4 s before the end: sim-only chunks (the policy and
    // the HUD's event handlers run inside them), real frames between.
    const ffEnd = (PLAYTEST_RUN_S - 4) * 10
    for (let guard = 0; guard < 400; guard++) {
      const tick = await page.evaluate(() => window.__pm!.core.state.tick)
      const left = ffEnd - tick
      if (left <= 0) break
      await page.evaluate(
        (ms) => window.__pm!.advance(ms),
        Math.min(PLAYTEST_FF_CHUNK_MS, left * 100),
      )
      await page.waitForTimeout(100)
    }
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
        `firstDelivery ${p.firstDeliveryS} caught ${p.firstMalware.caughtS} by ${p.firstMalware.by} ` +
        `L2-5 ${p.level2AtS}/${p.level3AtS}/${p.level4AtS}/${p.level5AtS} victory ${p.victoryAtS} ` +
        `hires ${p.hires.length} (${p.hires.filter((h) => !h.cheapest).length} not cheapest) ` +
        `quests ${JSON.stringify({ ...p.quests, byTemplate: undefined })} ` +
        `overseas ${JSON.stringify(p.overseas)} docks ${JSON.stringify(p.docksBought)} ` +
        `desks ${p.desks} sorter ${JSON.stringify(p.sorter)} lives ${p.livesLost.length}`,
    )
    expect(p.version).toBe(2)
    expect(p.seed).toBe(7)
    expect(p.simS).toBeGreaterThanOrEqual(PLAYTEST_RUN_S)
    expect(p.moneyPerMin.length).toBe(Math.floor(p.simS / 60))
    expect(p.viewSwitches).toBeGreaterThanOrEqual(2)
    expect(p.warehouseS).toBeGreaterThanOrEqual(50)
    expect(p.warehouseS).toBeLessThanOrEqual(80)
    expect(p.taps).toBeGreaterThanOrEqual(3)
    expect(p.fps.samples).toBeGreaterThan(30)
    expect(p.firstDeliveryS).not.toBeNull()
    // The fast-forward kept the event-fed fields: L3+ with its hand-offs,
    // the policy's hires and quests.
    expect(p.level3AtS).not.toBeNull()
    expect(p.hires.length).toBeGreaterThan(0)
    expect(p.quests.offered).toBeGreaterThan(0)
    expect(p.overseas.handedOff).toBeGreaterThanOrEqual(p.overseas.cleared)
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
    console.log(`shots: fun bar 2 ${JSON.stringify(st.checks)}`)
    expect(st.checks.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6])
    // Every button live and inside the canvas with the v2 rows.
    const L = await page.evaluate(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        L: { W: number; H: number }
      }
      return { W: hud.L.W, H: hud.L.H }
    })
    for (const id of [
      'summary:download',
      'summary:copy',
      'summary:keep',
      'summary:newGame',
    ]) {
      const r = await sceneTarget(page, 'HUD', id)
      expect(r, `${id} is live`).not.toBeNull()
      expect(r!.y + r!.h, `${id} bottom`).toBeLessThanOrEqual(L.H)
    }
    await pm.shot('summary-card', 20)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('summary-card', async ({ page, pm, consoleErrors }) => {
    test.skip(!isMinFit(), 'the iPhone shot comes from playtest-35min')
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

// ---- M6 ------------------------------------------------------------------

/** A new game at seed 7 in the room, no policy (Audrey alone at desk 1). */
const WH_NEW = `${CITY}&view=warehouse`

/** The room's people as WorkerSprites places them (tests / e2e hooks). */
function workerAt(
  page: Page,
  id: number,
): Promise<{ walking: boolean; at: Pt | null; count: number }> {
  return page.evaluate((eid) => {
    const wh = window.__pm!.game.scene.getScene('Warehouse') as unknown as {
      workers: {
        isWalking(id: number): boolean
        positionOf(id: number): Pt | null
        count: number
      }
    }
    return {
      walking: wh.workers.isWalking(eid),
      at: wh.workers.positionOf(eid),
      count: wh.workers.count,
    }
  }, id)
}

/** The rack lamp's `S` badge as LaneRenderer draws it. */
function sBadge(page: Page): Promise<{ visible: boolean; text: string }> {
  return page.evaluate(() => {
    const wh = window.__pm!.game.scene.getScene('Warehouse') as unknown as {
      lane: { sBadge: { visible: boolean; text: string } }
    }
    const b = wh.lane.sBadge
    return { visible: b.visible, text: b.text }
  })
}

/** Open a fleet-less Garage, tap the Bike buy card: the driver picker. */
async function openDriverPicker(page: Page, pm: PmHelpers): Promise<void> {
  await openGarage(page, pm)
  await tapTarget(page, pm, 'Garage', 'garage:buy:bike')
  expect(
    await settleUntil(
      page,
      pm,
      async () => (await hireSheet(page, 'Garage')) !== null,
    ),
    'the Bike buy card opens the driver HireSheet',
  ).toBe(true)
  await pm.settle(16) // the slide-in
}

test.describe('M6 shots', () => {
  test('hire-sheet', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await pm.open(WH_NEW)
    await pm.freeze()
    await pm.settle(30)
    // Real taps: the desk in slot 1 → its card → [Hire inspector].
    await tapRoomRect(page, pm, roomLayout.rectFor('slot1')!)
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'slot',
      ),
      'the desk card opens',
    ).toBe(true)
    await pm.settle(16) // the 150 ms tap guard + the slide-in
    await tapTarget(page, pm, 'Warehouse', 'slot:hire')
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'hire',
      ),
      '[Hire inspector] opens the HireSheet',
    ).toBe(true)
    // New buttons join the input list on the next update; the slide-in.
    await pm.settle(16)
    const hs = await hireSheet(page, 'Warehouse')
    console.log(`shots: hire-sheet ${JSON.stringify(hs)}`)
    expect(hs).toMatchObject({ id: 'wh:hire', role: 'inspector' })
    expect(hs!.ids).toHaveLength(3)
    const pool = await page.evaluate(() =>
      window.__pm!.sim.applicants('inspector').map((a) => a.id),
    )
    expect(hs!.ids).toEqual(pool)
    for (let i = 0; i < 3; i++)
      expect(
        await sceneTarget(page, 'Warehouse', `wh:hire:card:${i}`),
        `card ${i}'s Hire is live`,
      ).not.toBeNull()
    await pm.shot(shotName('hire-sheet'), 30)
    // Every card inside the canvas (110 px wide at 360, B2 §2.7 / design §6.1).
    const W = await page.evaluate(() => window.__pm!.game.scale.width)
    for (let i = 0; i < 3; i++) {
      const r = (await sceneTarget(page, 'Warehouse', `wh:hire:card:${i}`))!
      expect(r.x, `card ${i} left`).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w, `card ${i} right`).toBeLessThanOrEqual(W)
    }
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('garage-driver-picker', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(CITY)
    await pm.freeze()
    await pm.settle(10)
    await openDriverPicker(page, pm)
    const hs = await hireSheet(page, 'Garage')
    console.log(`shots: garage-driver-picker ${JSON.stringify(hs)}`)
    expect(hs).toMatchObject({ id: 'garage:hire', role: 'driver' })
    expect(hs!.ids).toHaveLength(3)
    expect(await sceneTexts(page, 'Garage')).toContain('Who drives the Bike?')
    for (const id of [
      'garage:hire:card:0',
      'garage:hire:card:1',
      'garage:hire:card:2',
      'garage:hire:ad',
      'garage:hire:later',
    ])
      expect(
        await sceneTarget(page, 'Garage', id),
        `${id} is live`,
      ).not.toBeNull()
    await pm.shot('garage-driver-picker', 20)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('warehouse-two-desks', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    // people-l3.json (tools/fixtures/people.ts): L3 (a real one since M8),
    // desk 2 in slot 3 with a charisma-2 inspector and a colleague. Loaded
    // without the policy: its dock-blocked rule could seat a new inspector
    // at desk 1 during the settle.
    await pm.open(WH_NEW)
    const { fixture } = await loadFixture(page, pm, 'people-l3')
    await pm.settle(64)
    const desks = fixture.desks as {
      index: number
      nodeId: string
      inspectorIds: number[]
      p: number[]
    }[]
    const st = await page.evaluate(() => {
      const api = window.__pm!
      return {
        warehouse: api.game.scene.isActive('Warehouse'),
        level: api.sim.level,
        desks: api.core.state.lane.nodes.flatMap((n) =>
          n.fixture?.kind === 'desk'
            ? [
                {
                  index: n.fixture.index,
                  nodeId: n.id,
                  inspectorIds: [...n.fixture.inspectorIds],
                  p: n.stations.map((s) => s.p ?? null),
                },
              ]
            : [],
        ),
      }
    })
    console.log(`shots: warehouse-two-desks ${JSON.stringify(st)}`)
    expect(st.warehouse).toBe(true)
    expect(st.level).toBe(fixture.level)
    expect(st.desks).toEqual(
      desks.map((d) => ({
        index: d.index,
        nodeId: d.nodeId,
        inspectorIds: d.inspectorIds,
        p: d.p,
      })),
    )
    const crew = desks.flatMap((d) => d.inspectorIds)
    for (const id of crew) {
      const w = await workerAt(page, id)
      expect(w.at, `inspector ${id} has a sprite`).not.toBeNull()
    }
    await pm.shot('warehouse-two-desks')
    // Desk 2's card: one row per inspector, the charisma lift per row.
    const desk2 = desks.find((d) => d.index === 2)!
    await tapRoomRect(page, pm, roomLayout.rectFor(desk2.nodeId)!)
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'slot',
      ),
      'desk 2 opens its card',
    ).toBe(true)
    const texts = await sceneTexts(page, 'Warehouse')
    expect(texts).toContain('Inspection desk 2')
    await pm.shot('warehouse-desk2-card', 30)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('station-sorter', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    // sorter-duty.json (no policy): a sorter on duty at L2 who has just
    // tagged a parcel `looks clean`.
    await pm.open(WH_NEW)
    const { fixture } = await loadFixture(page, pm, 'sorter-duty')
    await pm.settle(64)
    const sorter = fixture.sorter as { id: number; name: string }
    const st = await page.evaluate(() => {
      const hs = window.__pm!.sim.holdStation
      return {
        kind: hs.kind,
        unlocked: hs.unlocked,
        id: hs.sorter?.id ?? null,
        name: hs.sorter?.name ?? null,
        active: hs.sorter?.active ?? null,
      }
    })
    console.log(`shots: station-sorter ${JSON.stringify(st)}`)
    expect(st).toEqual({
      kind: 'sorter',
      unlocked: true,
      id: sorter.id,
      name: sorter.name,
      active: true,
    })
    const w = await workerAt(page, sorter.id)
    expect(w.walking, 'the loaded sorter is placed, not walking in').toBe(false)
    expect(w.at).toEqual({ x: SORTER_STAND.x, y: SORTER_STAND.y })
    expect(await sBadge(page)).toEqual({ visible: true, text: 'S' })
    await pm.shot('station-sorter')
    // The StationCard on duty (tap on the station).
    await tapStation(page, pm)
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'station',
      ),
      'the station opens the StationCard',
    ).toBe(true)
    expect(await sceneTexts(page, 'Warehouse')).toContain(sorter.name)
    await pm.shot('station-card', 30)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('holdcard-sorter-hint', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await pm.open(WH_NEW)
    const { fixture } = await loadFixture(page, pm, 'sorter-duty')
    await pm.settle(64)
    const bay = await page.evaluate(
      (id) =>
        window.__pm!.sim.holdBay.items.find((it) => it.parcelId === id)?.bay ??
        null,
      fixture.parcelId as number,
    )
    expect(bay, 'the tagged parcel waits in a bay').not.toBeNull()
    await tapRoomRect(page, pm, bayRect(bay!))
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await openSheet(page)) === 'hold',
      ),
      'the Hold Bay card opens',
    ).toBe(true)
    await pm.settle(16)
    const card = await page.evaluate(() => {
      const wh = window.__pm!.game.scene.getScene('Warehouse') as unknown as {
        holdCard: { parcelId: number | null }
      }
      return wh.holdCard.parcelId
    })
    expect(card).toBe(fixture.parcelId)
    const texts = await sceneTexts(page, 'Warehouse')
    console.log(
      `shots: holdcard-sorter-hint ${JSON.stringify(texts.filter((t) => /looks clean|Inspector/.test(t)))}`,
    )
    expect(texts).toContain(fixture.holdCardLine as string)
    // Opening the card is the player's touch (design D3): replay-logged.
    const touched = await page.evaluate(() => {
      const log = window.__pm!.core.commandLog
      return log[log.length - 1]?.cmd.kind ?? null
    })
    expect(touched).toBe('touchHeld')
    await pm.shot(shotName('holdcard-sorter-hint'), 30)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

// ---- M7 ------------------------------------------------------------------

/** The HUD's QuestCard / VictoryCard rect and the bands around them (logical px). */
function questCardFit(page: Page): Promise<{
  W: number
  H: number
  card: { x: number; y: number; w: number; h: number }
  bandTop: number
  bandBottom: number
}> {
  return page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      L: {
        W: number
        H: number
        ticker: { y: number; h: number }
        bottomBar: { y: number }
      }
      questCard: { rect: { x: number; y: number; w: number; h: number } }
    }
    const L = hud.L
    return {
      W: L.W,
      H: L.H,
      card: { ...hud.questCard.rect },
      bandTop: L.ticker.y + L.ticker.h,
      bandBottom: L.bottomBar.y,
    }
  })
}

/** Every live target `ids` of scene `key` lies inside the W×H canvas. */
async function expectInside(
  page: Page,
  key: string,
  ids: readonly string[],
): Promise<void> {
  const L = await page.evaluate(() => ({
    W: window.__pm!.game.scale.width,
    H: window.__pm!.game.scale.height,
  }))
  for (const id of ids) {
    const r = await sceneTarget(page, key, id)
    expect(r, `${id} is live`).not.toBeNull()
    expect(r!.x, `${id} left`).toBeGreaterThanOrEqual(0)
    expect(r!.y, `${id} top`).toBeGreaterThanOrEqual(0)
    expect(r!.x + r!.w, `${id} right`).toBeLessThanOrEqual(L.W)
    expect(r!.y + r!.h, `${id} bottom`).toBeLessThanOrEqual(L.H)
  }
}

/** Sim-only 100-ms steps until `cond(api)` holds in the page (cap `capMs`). */
async function advanceUntil(
  page: Page,
  cond: string,
  capMs: number,
): Promise<{ ok: boolean; ms: number; tick: number }> {
  return page.evaluate(
    ([src, cap]) => {
      const api = window.__pm!
      const f = new Function('api', `return (${src as string})`) as (
        a: typeof api,
      ) => boolean
      let ms = 0
      while (!f(api) && ms < (cap as number)) {
        api.advance(100)
        ms += 100
      }
      return { ok: f(api), ms, tick: api.sim.tick }
    },
    [cond, capMs] as const,
  )
}

/** Abandon the quest the policy holds (a logged command), if any. */
async function abandonActive(page: Page): Promise<void> {
  await page.evaluate(() => {
    const vs = window.__pm!.sim
    if (vs.quests().active) vs.quest.abandon()
  })
}

/** Policy 40 s, then the magic quest offered by debug and accepted. */
async function magicQuest(
  page: Page,
  pm: PmHelpers,
): Promise<{ id: string; origin: string; dest: string; parcelId: number }> {
  await pm.open(POLICY)
  await runFor(page, pm, 40_000)
  const id = await debugQuest(page, 'magic_parcel')
  const ui = await questUi(page)
  expect(ui.active?.route, 'the magic quest has its route').toBeTruthy()
  return {
    id,
    origin: ui.active!.route!.origin,
    dest: ui.active!.route!.dest,
    parcelId: ui.active!.parcelId!,
  }
}

test.describe('M7 shots', () => {
  test('quest-offer', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await pm.open(`${CITY}&quest=rush_district`)
    await pm.freeze()
    // 20 s with no player: parcels wait (the badges), the offer stands (1 day).
    await page.evaluate(() => window.__pm!.advance(20_000))
    expect(
      await settleUntil(page, pm, async () => {
        const ui = await questUi(page)
        return ui.card.open && ui.card.mode === 'offer'
      }),
      'the ?quest= offer opens its card',
    ).toBe(true)
    await pm.settle(30)
    const ui = await questUi(page)
    const fit = await questCardFit(page)
    console.log(
      `shots: quest-offer ${JSON.stringify({ offer: ui.offer, card: ui.card, fit })}`,
    )
    expect(ui.card).toMatchObject({
      title: 'Rush hour',
      buttons: ['accept', 'later', 'decline'],
    })
    expect(fit.card.x).toBeGreaterThanOrEqual(0)
    expect(fit.card.x + fit.card.w).toBeLessThanOrEqual(fit.W)
    expect(fit.card.y).toBeGreaterThanOrEqual(fit.bandTop)
    expect(fit.card.y + fit.card.h).toBeLessThanOrEqual(fit.bandBottom)
    await expectInside(page, 'HUD', [
      'quest:accept',
      'quest:later',
      'quest:decline',
    ])
    await pm.shot(shotName('quest-offer'), 20)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('quest-chip', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    test.setTimeout(180_000)
    await pm.open(`${POLICY}&fastForward=720`)
    await pm.freeze()
    await abandonActive(page)
    await debugQuest(page, 'rush_district')
    const run = await advanceUntil(
      page,
      `(api.core.state.quests.active?.progress.kind === 'deliveriesFrom' && api.core.state.quests.active.progress.count >= 4)`,
      240_000,
    )
    await pm.settle(8)
    const ui = await questUi(page)
    console.log(
      `shots: quest-chip after ${run.ms} ms ${JSON.stringify({ active: ui.active, chip: ui.chip })}`,
    )
    expect(run.ok, 'four deliveries from the rush district').toBe(true)
    expect(ui.active).toMatchObject({ templateId: 'rush_district', goal: 10 })
    expect(ui.chip.visible).toBe(true)
    expect(ui.chip.barText).toMatch(/^[4-9]\/10$/)
    expect(await page.evaluate(() => window.__pm!.sim.level)).toBe(2)
    await pm.shot('quest-chip', 20)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('magic-parcel', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    const q = await magicQuest(page, pm)
    const a = await buildingCentre(page, q.origin)
    const b = await buildingCentre(page, q.dest)
    await focusCity(page, {
      x: Math.round((a.x + b.x) / 2),
      y: Math.round((a.y + b.y) / 2),
    })
    await pm.settle(30)
    const st = await page.evaluate(
      ([o, d, pid]) => {
        const api = window.__pm!
        const city = api.game.scene.getScene('City') as unknown as {
          buildings: Map<string, { magic: boolean; anchor: Pt; topY: number }>
          cameras: {
            main: { worldView: { contains(x: number, y: number): boolean } }
          }
        }
        const view = city.cameras.main.worldView
        const seen = (id: string): boolean => {
          const v = city.buildings.get(id)
          return !!v && view.contains(v.anchor.x, v.topY)
        }
        return {
          parcel: api.core.state.parcels[pid as number]?.state ?? null,
          marks: [
            city.buildings.get(o as string)?.magic ?? false,
            city.buildings.get(d as string)?.magic ?? false,
          ],
          onScreen: [seen(o as string), seen(d as string)],
          rushed: api.sim.rushState(o as string) !== null,
        }
      },
      [q.origin, q.dest, q.parcelId] as const,
    )
    console.log(`shots: magic-parcel ${JSON.stringify({ ...q, ...st })}`)
    expect(st.parcel, 'the golden parcel still waits at A').toBe('waiting')
    expect(st.marks).toEqual([true, true])
    expect(st.onScreen, 'A and B both in frame').toEqual([true, true])
    await pm.shot('magic-parcel', 10)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('quest-complete', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    test.setTimeout(180_000)
    const q = await magicQuest(page, pm)
    // Sim-only until the golden parcel rides out of the warehouse …
    const out = await advanceUntil(
      page,
      `['loaded', 'in_transit_out'].includes(api.core.state.parcels[${q.parcelId}]?.state ?? '') || api.quests().active === null`,
      120_000,
    )
    expect(out.ok).toBe(true)
    const pending = await page.evaluate(() => window.__pm!.quests().active)
    expect(pending, 'still on its way (not delivered yet)').not.toBeNull()
    await focusCity(page, await buildingCentre(page, q.dest))
    await pm.settle(64)
    // … then real frames at 4× to the delivery at B, so the stamp starts
    // on a rendered frame with everything around it in play.
    const done = await page.evaluate(() => {
      const api = window.__pm!
      const ev = api.core.events as unknown as {
        on(n: string, f: (p: unknown) => void): unknown
        off(n: string, f: (p: unknown) => void): unknown
      }
      const got: { reward: unknown } = { reward: null }
      const fn = (p: unknown): void => {
        got.reward ??= (p as { reward: unknown }).reward
      }
      ev.on('quest:completed', fn)
      api.speed(4)
      let frames = 0
      while (got.reward === null && frames < 6000) {
        api.step(16)
        frames++
      }
      api.speed(1)
      ev.off('quest:completed', fn)
      return { frames, reward: got.reward }
    })
    console.log(
      `shots: quest-complete after ${done.frames} frames ${JSON.stringify(done.reward)}`,
    )
    expect(done.reward, 'quest:completed (on time)').not.toBeNull()
    // 36 frames ≈ 580 ms: the stamp half-way up its 1.2-s rise.
    await pm.shot('quest-complete', 36)
    const ui = await questUi(page)
    const st = await page.evaluate(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        questStamp: {
          ms: number
          root: { list: { text?: string }[] }
        } | null
      }
      const s = hud.questStamp
      return {
        ms: s?.ms ?? null,
        text:
          s?.root.list.find((o) => typeof o.text === 'string')?.text ?? null,
        lives: window.__pm!.sim.lives,
      }
    })
    console.log(`shots: quest-complete stamp ${JSON.stringify(st)}`)
    expect(ui.stamp, 'the QUEST COMPLETE stamp is up').toBe(true)
    expect(st.text).toMatch(/^QUEST COMPLETE /)
    expect(st.lives, 'the golden parcel gave a life').toBe(4)
    // The new slot blinks 3× (LivesRow.gainLife), then stays lit: 4 of 5.
    await pm.settle(120)
    const lit = await page.evaluate(
      () =>
        (
          window.__pm!.game.scene.getScene('HUD') as unknown as {
            lives: { slots: { frame: { name: string } }[] }
          }
        ).lives.slots.filter((x) => x.frame.name === 'ic_life_on').length,
    )
    expect(lit, 'bomb slot 4 lit after its blink').toBe(4)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('district-panel-quest', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(`${POLICY}&quest=rush_district`)
    await runFor(page, pm, 30_000)
    const ui = await questUi(page)
    expect(ui.active, 'the policy accepted the rush').toMatchObject({
      templateId: 'rush_district',
    })
    const target = ui.active!.target!
    await emit(page, 'pm:select', { kind: 'district', id: target })
    await pm.settle(40)
    const open = await page.evaluate(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        district: { isOpen(): boolean; districtId: string | null } | null
      }
      return hud.district?.isOpen() ? hud.district.districtId : null
    })
    expect(open).toBe(target)
    const row = (await sceneTexts(page, 'HUD')).find((t) =>
      t.startsWith('Rush hour'),
    )
    console.log(`shots: district-panel-quest ${target} "${row}"`)
    expect(row).toMatch(/^Rush hour · \d\/6 · /)
    // The row's tap band leads to this quest's card (DistrictPanel.questId).
    expect(
      await page.evaluate(
        () =>
          (
            window.__pm!.game.scene.getScene('HUD') as unknown as {
              district: { questId: string | null }
            }
          ).district.questId,
      ),
    ).toBe(ui.active!.id)
    await pm.shot('district-panel-quest')
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('victory-card', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    test.setTimeout(180_000)
    await pm.open(`${POLICY}&fastForward=600`)
    await pm.freeze()
    await pm.settle(64)
    await abandonActive(page)
    await debugQuest(page, 'golden_release')
    await pm.settle(8)
    const w = await finishUltimate(page)
    expect(w.ok, 'game:victory').toBe(true)
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await questUi(page)).victoryCard,
      ),
      'the VictoryCard opens',
    ).toBe(true)
    await pm.settle(30)
    const ui = await questUi(page)
    console.log(
      `shots: victory-card ${JSON.stringify({ day: w.day, holds: ui.holds, paused: ui.paused, victory: ui.victory })}`,
    )
    expect(ui.holds).toContain('victory')
    await expectInside(page, 'HUD', [
      'victory:continue',
      'victory:newGame',
      'victory:summary',
    ])
    const texts = await sceneTexts(page, 'HUD')
    expect(texts).toContain('TYCOON')
    await pm.shot(shotName('victory-card'), 20)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

// ---- M8 ------------------------------------------------------------------

/**
 * Real 16-ms frames at `speed`× until `cond(api)` has held for `hold`
 * frames in a row (cap `capFrames`), then back to 1×: every sprite the view
 * shows comes in its own time, as in play (a sim-only advance would spawn
 * them all on one frame); `hold` > 1 skips one-tick states.
 */
async function framesUntil(
  page: Page,
  cond: string,
  capFrames: number,
  speed: 1 | 2 | 4 = 4,
  hold = 1,
): Promise<{ ok: boolean; frames: number; tick: number }> {
  return page.evaluate(
    ([src, cap, sp, h]) => {
      const api = window.__pm!
      const f = new Function('api', `return (${src as string})`) as (
        a: typeof api,
      ) => boolean
      api.speed(sp as 1 | 2 | 4)
      let frames = 0
      let run = f(api) ? 1 : 0
      while (run < (h as number) && frames < (cap as number)) {
        api.step(16)
        frames++
        run = f(api) ? run + 1 : 0
      }
      api.speed(1)
      return { ok: run >= (h as number), frames, tick: api.sim.tick }
    },
    [cond, capFrames, speed, hold] as const,
  )
}

/** The City's hub probe (CityScene.hubProbe) plus the vessel's phase t. */
function hubState(
  page: Page,
  hub: string,
): Promise<{ phase: string; ring: number | null; t: number } | null> {
  return page.evaluate((h) => {
    const city = window.__pm!.game.scene.getScene('City') as unknown as {
      hubProbe(id: string): { phase: string; ring: number | null } | null
      hubViews: Map<string, { state: { phase: string; t: number } }>
    }
    const p = city.hubProbe(h)
    const v = city.hubViews.get(h)
    return p ? { ...p, t: v?.state.t ?? -1 } : null
  }, hub)
}

/** The world position (anchor) of a hub's vessel prop and its image's. */
function vesselAt(
  page: Page,
  hub: string,
): Promise<{ home: Pt; img: Pt | null; visible: boolean } | null> {
  return page.evaluate((h) => {
    const api = window.__pm!
    const row = api.data.map.hubs.find((x) => x.district === h)
    if (!row) return null
    const city = api.game.scene.getScene('City') as unknown as {
      props: {
        region: string
        tile: readonly [number, number]
        x: number
        y: number
        img: { x: number; y: number; visible: boolean } | null
      }[]
    }
    const p = city.props.find(
      (pv) =>
        pv.region === h &&
        pv.tile[0] === row.vessel.tile[0] &&
        pv.tile[1] === row.vessel.tile[1],
    )
    if (!p) return null
    return {
      home: { x: p.x, y: p.y },
      img: p.img ? { x: p.img.x, y: p.img.y } : null,
      visible: p.img?.visible ?? false,
    }
  }, hub)
}

/** Zoom the City camera to `z` about the screen centre. */
async function cityZoom(page: Page, z: 1 | 2): Promise<void> {
  await page.evaluate((zz) => {
    const api = window.__pm!
    const city = api.game.scene.getScene('City') as unknown as {
      rig: { zoomAt(z: 1 | 2, px: number, py: number): void }
    }
    const { width: W, height: H } = api.game.scale
    city.rig.zoomAt(zz, Math.round(W / 2), Math.round(H / 2))
  }, z)
}

test.describe('M8 shots', () => {
  test('level-up-3', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await levelUpAt(page, pm, POLICY, 'warehouse', 'level-up-3', 3)
    // 38 frames = 608 ms: dust frame 2 (500-749 ms), the stamp rising.
    await pm.shot('level-up-3', 38)
    const st = await page.evaluate(() => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        construction: { start: number } | null
        time: { now: number }
      }
      const c = city.construction
      return { ms: c ? city.time.now - c.start : null }
    })
    console.log(`shots: level-up-3 construction at ${JSON.stringify(st)}`)
    expect(st.ms, 'the construction overlay is up').not.toBeNull()
    expect(st.ms!).toBeGreaterThanOrEqual(500)
    expect(st.ms!).toBeLessThan(750)
    expect((await paperState(page)).visible, 'no paper over the moment').toBe(
      false,
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('docks-live', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await levelUpAt(page, pm, POLICY, 'docks', 'level-up-3', 3)
    // 100 frames = 1.6 s: the 1-s fog cross-fade and the sign pop are done.
    await pm.shot('docks-live', 100)
    const st = await page.evaluate(() => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        byDistrict: Map<
          string,
          { id: string; image: { frame: { name: string } } | null }[]
        >
      }
      return {
        region: window.__pm!.sim.regionState('docks'),
        chips: (
          window.__pm!.game.scene.getScene('HUD') as unknown as {
            chips: { entry: { id: string; lockLevel: number | null } }[]
          }
        ).chips.map((c) => `${c.entry.id}:${c.entry.lockLevel ?? ''}`),
        frames: (city.byDistrict.get('docks') ?? []).map(
          (v) => `${v.id}:${v.image?.frame.name ?? '-'}`,
        ),
      }
    })
    console.log(`shots: docks-live ${JSON.stringify(st)}`)
    expect(st.region).toBe('live')
    expect(st.chips).toContain('docks:')
    expect(st.frames.length).toBeGreaterThan(0)
    for (const f of st.frames) expect(f, 'in colour').not.toMatch(/_locked$/)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('warehouse-tier3', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await levelUpAt(page, pm, WH_POLICY, null, 'level-up-3', 3)
    // 64 frames ≈ 1 s: the 400-ms tier cross-fade and the shelf re-grid.
    await pm.shot(shotName('warehouse-tier3'), 64)
    // The clock is frozen, so this reads the state the PNG shows: the fade
    // is over (no tier part or the sign text mid-tween — the ghost copies of
    // the old frames run the same 400 ms —, every tier-only part at full
    // alpha or hidden, the floor on t3 frames).
    const st = await page.evaluate(() => {
      const api = window.__pm!
      type Obj = { visible: boolean; alpha: number }
      const wh = api.game.scene.getScene('Warehouse') as unknown as {
        tweens: { isTweening(o: unknown): boolean }
        lane: {
          tier: number
          bulb: Obj
          strips: Obj[]
          plates: Obj[]
          props: Map<number, Obj[]>
          signText: Obj
          floorImgs: { img: { frame: { name: string } } }[]
        }
      }
      const L = wh.lane
      const parts: [string, Obj][] = [
        ['bulb', L.bulb],
        ['sign', L.signText],
        ...L.strips.map((o, i): [string, Obj] => [`strip${i}`, o]),
        ...L.plates.map((o, i): [string, Obj] => [`plate${i}`, o]),
        ...[...L.props].flatMap(([g, imgs]) =>
          imgs.map((o, i): [string, Obj] => [`props${g}.${i}`, o]),
        ),
      ]
      const fading = parts
        .filter(
          ([, o]) => wh.tweens.isTweening(o) || (o.visible && o.alpha < 1),
        )
        .map(([n]) => n)
      const shown = (g: number): boolean =>
        (L.props.get(g) ?? []).every((o) => o.visible)
      return {
        warehouse: api.game.scene.isActive('Warehouse'),
        level: api.sim.level,
        tier: L.tier,
        fading,
        bulb: L.bulb.visible,
        strips: L.strips.every((o) => o.visible),
        props3: shown(3),
        props2: (L.props.get(2) ?? []).some((o) => o.visible),
        floorT3: L.floorImgs.every((f) =>
          f.img.frame.name.startsWith('floor_t3'),
        ),
        shelfCap: api.core.state.lane.nodes.find((n) => n.id === 'shelf')?.cap,
        holdCap: api.sim.holdBay.cap,
      }
    })
    console.log(`shots: warehouse-tier3 ${JSON.stringify(st)}`)
    expect(st).toMatchObject({ warehouse: true, level: 3, tier: 3 })
    expect(st.fading, 'the tier cross-fade has finished').toEqual([])
    expect(st).toMatchObject({
      bulb: false,
      strips: true,
      props3: true,
      props2: false,
      floorT3: true,
    })
    expect((await paperState(page)).visible, 'no paper over the room').toBe(
      false,
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('warehouse-two-docks', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    test.setTimeout(180_000)
    await pm.open(WH_POLICY)
    const { fixture } = await loadFixture(page, pm, 'l3-docks')
    await pm.settle(16)
    // Real frames at 4× until both docks have held a docked vehicle for ~1 s
    // (DockView's rule: a `docked_*` state, not just assigned — ≈ 47 s of sim).
    const w = await framesUntil(
      page,
      `api.core.state.lane.docks.length === 2 && api.core.state.lane.docks.every((d) => api.core.state.vehicles.find((v) => v.id === d.vehicleId)?.state.startsWith('docked') === true)`,
      4000,
      4,
      16, // ≈ 1 s of sim at 4× (seed 7: both docked from 46.1 s to 54 s)
    )
    console.log(`shots: warehouse-two-docks both busy ${JSON.stringify(w)}`)
    expect(w.ok, 'both docks unloading').toBe(true)
    await pm.shot(shotName('warehouse-two-docks'), 20)
    const st = await page.evaluate(() => {
      const api = window.__pm!
      return {
        warehouse: api.game.scene.isActive('Warehouse'),
        slots: api.sim.lane
          .dockSlots()
          .map(
            (d) =>
              `${d.index}:${d.owned ? 'owned' : d.available ? 'buy' : 'locked'}`,
          ),
        docks: api.core.state.lane.docks.map((d) => ({
          id: d.id,
          state:
            api.core.state.vehicles.find((v) => v.id === d.vehicleId)?.state ??
            null,
        })),
      }
    })
    console.log(`shots: warehouse-two-docks ${JSON.stringify(st)}`)
    expect(st.warehouse).toBe(true)
    // M9: l3-docks.json is at a real L4 (dock 3 for sale from L4).
    const dock3 = await page.evaluate(
      () =>
        window.__pm!.data.economy.docks.find((d) => d.index === 3)!.unlockLevel,
    )
    expect(st.slots).toEqual([
      '1:owned',
      '2:owned',
      (fixture.level as number) >= dock3 ? '3:buy' : '3:locked',
    ])
    expect(st.docks.map((d) => d.id)).toEqual(fixture.docks)
    for (const d of st.docks)
      expect(d.state ?? '', `${d.id} docked`).toMatch(/^docked/)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('warehouse-dock-dialog', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    // overseas-malware.json: a real L3 with dock 1 only (no level-up paper,
    // no policy); the dialog opens whatever the balance.
    await pm.open(WH_NEW)
    await loadFixture(page, pm, 'overseas-malware')
    await pm.settle(30)
    expect(
      await page.evaluate(() =>
        window
          .__pm!.sim.lane.dockSlots()
          .map((d) => [d.index, d.available, d.owned]),
      ),
    ).toEqual([
      [1, true, true],
      [2, true, false],
      [3, false, false],
    ])
    await tapRoomRect(page, pm, dockHit(2))
    await pm.settle(16)
    expect(
      await sceneTarget(page, 'Warehouse', 'wh:dockDialog:confirm'),
      'the dock 2 dialog is up',
    ).not.toBeNull()
    const texts = await sceneTexts(page, 'Warehouse')
    console.log(
      `shots: warehouse-dock-dialog ${JSON.stringify(texts.filter((t) => /dock|\$800/.test(t)))}`,
    )
    expect(texts).toContain('Loading dock 2')
    expect(texts).toContain('$800 · a second door into slot 1')
    expect(texts).toContain('Buy $800')
    await pm.shot('warehouse-dock-dialog', 20)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('clearance-ring', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(POLICY)
    const { fixture } = await loadFixture(page, pm, 'l3-docks')
    await pm.settle(5)
    const office = fixture.officeId as string
    await cityZoom(page, 2)
    await focusCity(page, await buildingCentre(page, office))
    await pm.settle(10)
    // Sim-only to 20 s before the fixture clearance: the ring ~55 % drained.
    const lead = (fixture.clearInS as number) - 20
    await page.evaluate((ms) => window.__pm!.advance(ms), lead * 1000)
    await focusCity(page, await buildingCentre(page, office))
    await pm.settle(30)
    const st = await hubState(page, 'docks')
    const hub = await page.evaluate(() => {
      const h = window.__pm!.sim.hub('docks')
      return h
        ? {
            live: h.live,
            office: h.office,
            clearing: h.clearing.map((c) => c.parcelId),
          }
        : null
    })
    console.log(`shots: clearance-ring ${JSON.stringify({ st, hub, lead })}`)
    expect(hub?.live).toBe(true)
    expect(hub?.office).toBe(office)
    expect(hub?.clearing[0]).toBe(fixture.clearingParcelId)
    expect(st?.ring, 'a ring over the office').not.toBeNull()
    expect(st!.ring!).toBeGreaterThan(0)
    expect(st!.ring!).toBeLessThan(8)
    await pm.shot('clearance-ring', 10)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('ship-departure', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await pm.open(POLICY)
    const { fixture } = await loadFixture(page, pm, 'l3-docks')
    await pm.settle(5)
    const v0 = await vesselAt(page, 'docks')
    expect(v0, 'the Docks vessel prop').not.toBeNull()
    // Half-way along the sail's first 2 s (t² ease: a quarter of `exit`).
    await focusCity(page, { x: v0!.home.x - 40, y: v0!.home.y - 40 })
    await pm.settle(10)
    const capMs = ((fixture.clearInS as number) + 10) * 1000
    const w = await page.evaluate(
      (cap) => window.__pm!.waitEvent('hub:departure', cap),
      capMs,
    )
    console.log(
      `shots: ship-departure hub:departure after ${w.waitedMs} ms ${JSON.stringify(w.payload)}`,
    )
    expect(w.ok, 'the fixture clearance sails the ship').toBe(true)
    expect(w.payload!.hub).toBe('docks')
    // shot(…, 0) renders no frame of its own: hide the overlay, stamp, then
    // 2 s of frames (125 × 16 ms) from the departure frame.
    await pm.overlay(false)
    await pm.stamp('test')
    await pm.settle(125)
    const st = await hubState(page, 'docks')
    const v = await vesselAt(page, 'docks')
    console.log(`shots: ship-departure ${JSON.stringify({ st, v })}`)
    expect(st?.phase).toBe('out')
    expect(st!.t).toBeGreaterThan(0.4)
    expect(st!.t).toBeLessThan(0.6)
    expect(v?.visible).toBe(true)
    expect(v!.img!.x, 'the ship moved west').toBeLessThan(v!.home.x)
    await pm.shot('ship-departure', 0)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('lost-life-overseas', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await pm.open(POLICY)
    const { fixture } = await loadFixture(page, pm, 'overseas-malware')
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
    const lost = w.payload
    // Build 3: the parcel variant (an event's life has no parcel).
    if (lost?.cause === 'event') throw new Error('an event took the life')
    console.log(
      `shots: lost-life-overseas life:lost after ${w.waitedMs} ms ${JSON.stringify(lost?.report.path.slice(-3) ?? null)}`,
    )
    expect(w.ok, 'the handed-off malware clears').toBe(true)
    expect(lost!.parcelId).toBe(fixture.parcelId)
    expect(lost!.report.viaClearance).toBe(true)
    expect(w.waitedMs).toBe(
      Math.ceil((fixture.lifeLostInS as number) * 10) * 100,
    )
    expect(
      await settleUntil(page, pm, async () => (await hudCards(page)).lost),
      'the lost-life card opens (600 ms after the loss)',
    ).toBe(true)
    await pm.shot(shotName('lost-life-overseas'), 30)
    const texts = await sceneTexts(page, 'HUD')
    const route = texts.filter((t) => /^(Handed off at|Cleared) /.test(t))
    console.log(`shots: lost-life-overseas route ${JSON.stringify(route)}`)
    expect(route.length).toBe(2)
    expect(route[0]).toMatch(/^Handed off at Prefetch Pier \d \d+:\d\d$/)
    expect(route[1]).toMatch(/^Cleared \d+:\d\d — the ship has sailed$/)
    expect(texts).toContain('MALWARE DELIVERED')
    expect(await page.evaluate(() => window.__pm!.sim.lives)).toBe(
      (fixture.lives as number) - 1,
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

// ---- M9 ------------------------------------------------------------------

/** The region's buildings and their frames in the City (`id:frame`). */
function regionFrames(page: Page, region: string): Promise<string[]> {
  return page.evaluate((r) => {
    const city = window.__pm!.game.scene.getScene('City') as unknown as {
      byDistrict: Map<
        string,
        { id: string; image: { frame: { name: string } } | null }[]
      >
    }
    return (city.byDistrict.get(r) ?? []).map(
      (v) => `${v.id}:${v.image?.frame.name ?? '-'}`,
    )
  }, region)
}

/** The HUD's region chips as `id:lockLevel` (M3). */
function chipEntries(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      window.__pm!.game.scene.getScene('HUD') as unknown as {
        chips: { entry: { id: string; lockLevel: number | null } }[]
      }
    ).chips.map((c) => `${c.entry.id}:${c.entry.lockLevel ?? ''}`),
  )
}

/**
 * The room's tier-only parts as the frozen frame shows them (warehouse-tier3's
 * probe, M9 tiers): any still mid-fade, which prop groups show, the floor's
 * tier, the strip lights' frames.
 */
function roomTierProbe(page: Page): Promise<{
  warehouse: boolean
  level: number
  tier: number
  fading: string[]
  bulb: boolean
  strips: boolean
  stripFrames: string[]
  propsShown: number[]
  floorTier: string[]
  slots: string[]
  shelfCap: number | null | undefined
}> {
  return page.evaluate(() => {
    const api = window.__pm!
    type Obj = { visible: boolean; alpha: number }
    type Img = Obj & { frame: { name: string } }
    const wh = api.game.scene.getScene('Warehouse') as unknown as {
      tweens: { isTweening(o: unknown): boolean }
      lane: {
        tier: number
        bulb: Obj
        strips: Img[]
        plates: Obj[]
        props: Map<number, Obj[]>
        signText: Obj
        floorImgs: { img: { frame: { name: string } } }[]
      }
    }
    const L = wh.lane
    const parts: [string, Obj][] = [
      ['bulb', L.bulb],
      ['sign', L.signText],
      ...L.strips.map((o, i): [string, Obj] => [`strip${i}`, o]),
      ...L.plates.map((o, i): [string, Obj] => [`plate${i}`, o]),
      ...[...L.props].flatMap(([g, imgs]) =>
        imgs.map((o, i): [string, Obj] => [`props${g}.${i}`, o]),
      ),
    ]
    return {
      warehouse: api.game.scene.isActive('Warehouse'),
      level: api.sim.level,
      tier: L.tier,
      fading: parts
        .filter(
          ([, o]) => wh.tweens.isTweening(o) || (o.visible && o.alpha < 1),
        )
        .map(([n]) => n),
      bulb: L.bulb.visible,
      strips: L.strips.length > 0 && L.strips.every((o) => o.visible),
      stripFrames: [...new Set(L.strips.map((o) => o.frame.name))],
      propsShown: [...L.props]
        .filter(([, imgs]) => imgs.length > 0 && imgs.every((o) => o.visible))
        .map(([g]) => g),
      floorTier: [
        ...new Set(
          L.floorImgs.map((f) =>
            f.img.frame.name.replace(/^floor_(t\d).*$/, '$1'),
          ),
        ),
      ],
      slots: api.sim.lane
        .nodes()
        .filter((n) => n.kind === 'slot' && !n.locked)
        .map((n) => n.id),
      shelfCap: api.core.state.lane.nodes.find((n) => n.id === 'shelf')?.cap,
    }
  })
}

/** WarehouseScene's maxScroll for a tier at this viewport (design §6.1). */
function expectedMaxScroll(tier: number): number {
  const minFit = isMinFit()
  if (tier === 4) return minFit ? 64 : 9
  if (tier === 5) return minFit ? 128 : 73
  return 0
}

/** The HUD's open VictoryCard / its hold, through questUi. */
async function victoryCardUp(page: Page, pm: PmHelpers): Promise<boolean> {
  return settleUntil(page, pm, async () => (await questUi(page)).victoryCard)
}

test.describe('M9 shots', () => {
  for (const region of ['lowres', 'rural'] as const) {
    test(`${region}-live`, async ({ page, pm, consoleErrors }) => {
      phoneOnly()
      await levelUpAt(page, pm, POLICY, region, 'level-up-4', 4, true)
      // 100 frames = 1.6 s: the 1-s fog cross-fade and the sign pop are done.
      await pm.shot(`${region}-live`, 100)
      const st = {
        region: await page.evaluate(
          (r) => window.__pm!.sim.regionState(r),
          region,
        ),
        both: await page.evaluate(() => [
          window.__pm!.sim.regionState('lowres'),
          window.__pm!.sim.regionState('rural'),
        ]),
        chips: await chipEntries(page),
        frames: await regionFrames(page, region),
      }
      console.log(`shots: ${region}-live ${JSON.stringify(st)}`)
      expect(st.region).toBe('live')
      expect(st.both, 'both L4 regions went live together').toEqual([
        'live',
        'live',
      ])
      expect(st.chips).toContain(`${region}:`)
      expect(st.frames.length).toBeGreaterThan(0)
      for (const f of st.frames) expect(f, 'in colour').not.toMatch(/_locked$/)
      expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
    })
  }

  test('level-up-5', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    await levelUpAt(page, pm, POLICY, 'warehouse', 'level-up-5', 5, true)
    // 38 frames = 608 ms: dust frame 2 (500-749 ms), the stamp rising.
    await pm.shot('level-up-5', 38)
    const st = await page.evaluate(() => {
      const city = window.__pm!.game.scene.getScene('City') as unknown as {
        construction: { start: number } | null
        time: { now: number }
      }
      const c = city.construction
      return {
        ms: c ? city.time.now - c.start : null,
        offer: window.__pm!.quests().offer?.templateId ?? null,
      }
    })
    const hud = await sceneTexts(page, 'HUD')
    console.log(
      `shots: level-up-5 ${JSON.stringify({ ...st, level: hud.filter((t) => /Tycoon|Lv|\$/.test(t)).slice(0, 6) })}`,
    )
    expect(st.ms, 'the construction overlay is up').not.toBeNull()
    expect(st.ms!).toBeGreaterThanOrEqual(500)
    expect(st.ms!).toBeLessThan(750)
    expect(st.offer, 'the Golden Release offered on level:up {5}').toBe(
      'golden_release',
    )
    expect(
      hud.filter((t) => /coming soon/.test(t)),
      'no "coming soon" at the top level',
    ).toEqual([])
    expect((await paperState(page)).visible, 'no paper over the moment').toBe(
      false,
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  for (const region of ['airport', 'civic'] as const) {
    test(`${region}-live`, async ({ page, pm, consoleErrors }) => {
      phoneOnly()
      await levelUpAt(page, pm, POLICY, region, 'level-up-5', 5, true)
      await pm.shot(`${region}-live`, 100)
      const st = {
        region: await page.evaluate(
          (r) => window.__pm!.sim.regionState(r),
          region,
        ),
        chips: await chipEntries(page),
        frames: await regionFrames(page, region),
      }
      console.log(`shots: ${region}-live ${JSON.stringify(st)}`)
      expect(st.region).toBe('live')
      expect(st.chips).toContain(`${region}:`)
      // L5 is the top level: no chip is locked any more.
      for (const c of st.chips) expect(c, 'no lock left at L5').toMatch(/:$/)
      expect(st.frames.length).toBeGreaterThan(0)
      for (const f of st.frames) expect(f, 'in colour').not.toMatch(/_locked$/)
      expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
    })
  }

  test('warehouse-tier4', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await pm.open(WH_POLICY)
    const { fixture } = await loadFixture(page, pm, 'l4-room')
    await pm.settle(5)
    await quietHints(page)
    await pm.settle(59)
    expect(await roomScrollTo(page, 0)).toBe(0)
    await pm.shot(shotName('warehouse-tier4'), 20)
    const st = await roomTierProbe(page)
    const fit = await roomFit(page)
    console.log(`shots: warehouse-tier4 ${JSON.stringify({ st, fit })}`)
    expect(st).toMatchObject({ warehouse: true, level: 4, tier: 4 })
    expect(st.fading, 'no tier part mid-fade').toEqual([])
    expect(st.floorTier).toEqual(['t4'])
    expect(st.slots).toEqual(fixture.slots)
    expect(st.shelfCap).toBe(80)
    expect(fit.tier).toBe(4)
    expect(fit.roomH, '16 rows').toBe(16 * 32)
    expectRoomScrolls(fit, 'warehouse-tier4')
    expect(fit.maxScroll).toBe(expectedMaxScroll(4))
    expect(fit.scrollY, 'scrolled 0').toBe(0)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('warehouse-tier5', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await levelUpAt(page, pm, WH_POLICY, null, 'level-up-5', 5, true)
    // R21: the rebuild lands on the next frame, the old room fades out over
    // it for 400 ms, then slot 6 unrolls — 96 frames ≈ 1.5 s.
    await pm.settle(96)
    expect(await roomScrollTo(page, 0)).toBe(0)
    await pm.shot(shotName('warehouse-tier5'), 20)
    const st = await roomTierProbe(page)
    const fit = await roomFit(page)
    console.log(`shots: warehouse-tier5 ${JSON.stringify({ st, fit })}`)
    expect(st).toMatchObject({ warehouse: true, level: 5, tier: 5 })
    expect(st.fading, 'the re-layout fade has finished').toEqual([])
    expect(st.floorTier).toEqual(['t5'])
    expect(st.bulb).toBe(false)
    expect(st.strips).toBe(true)
    for (const f of st.stripFrames) expect(f).toMatch(/^neon_strip_f[01]$/)
    expect(st.slots).toEqual([
      'slot1',
      'slot2',
      'slot3',
      'slot4',
      'slot5',
      'slot6',
    ])
    expect(st.shelfCap).toBe(100)
    expect(fit.roomH, '18 rows').toBe(18 * 32)
    expectRoomScrolls(fit, 'warehouse-tier5')
    expect(fit.maxScroll).toBe(expectedMaxScroll(5))
    expect(fit.scrollY, 'scrolled 0').toBe(0)
    expect((await paperState(page)).visible, 'no paper over the room').toBe(
      false,
    )
    // R10: scrolled to the bottom the readout stays where it was.
    expect(await roomScrollTo(page, fit.maxScroll)).toBe(fit.maxScroll)
    await pm.shot(shotName('warehouse-tier5-scrolled'), 8)
    const down = await roomFit(page)
    expectRoomScrolls(down, 'warehouse-tier5-scrolled')
    expect(down.scrollY).toBe(fit.maxScroll)
    expect(down.readout).toEqual(fit.readout)
    expect(down.roomY).toBe(fit.roomY - fit.maxScroll)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('golden-release-offer', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    // No policy: it would accept the offer as soon as its quest ends.
    await pm.open(CITY)
    const { fixture } = await loadFixture(page, pm, 'l5-tycoon')
    await pm.settle(5)
    await quietHints(page)
    await pm.settle(11)
    if (fixture.activeQuestId !== null) await abandonActive(page)
    await pm.settle(8)
    const chip = (await questUi(page)).chip
    expect(chip.visible, 'the quest chip shows the offer').toBe(true)
    await tapTarget(page, pm, 'HUD', 'questChip')
    expect(
      await settleUntil(page, pm, async () => {
        const ui = await questUi(page)
        return ui.card.open && ui.card.mode === 'offer'
      }),
      'the chip opens the Golden Release card',
    ).toBe(true)
    await pm.settle(30)
    const ui = await questUi(page)
    const fit = await questCardFit(page)
    console.log(
      `shots: golden-release-offer ${JSON.stringify({ offer: ui.offer, card: ui.card, chip: ui.chip, fit })}`,
    )
    expect(ui.offer?.templateId).toBe('golden_release')
    expect(ui.offer?.id).toBe(fixture.questId)
    expect(ui.active).toBeNull()
    expect(ui.card).toMatchObject({
      questId: fixture.questId,
      gold: true,
      buttons: ['accept', 'later'],
    })
    expect(fit.card.x).toBeGreaterThanOrEqual(0)
    expect(fit.card.x + fit.card.w).toBeLessThanOrEqual(fit.W)
    expect(fit.card.y).toBeGreaterThanOrEqual(fit.bandTop)
    expect(fit.card.y + fit.card.h).toBeLessThanOrEqual(fit.bandBottom)
    await expectInside(page, 'HUD', ['quest:accept', 'quest:later'])
    await pm.shot(shotName('golden-release-offer'), 20)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('plane-departure', async ({ page, pm, consoleErrors }) => {
    phoneOnly()
    test.setTimeout(150_000)
    await pm.open(POLICY)
    const { fixture } = await loadFixture(page, pm, 'l5-tycoon')
    await pm.settle(5)
    await quietHints(page)
    const v0 = await vesselAt(page, 'airport')
    expect(v0, 'the Airport vessel prop (ap_plane)').not.toBeNull()
    expect(v0!.visible).toBe(true)
    // exit [4, 0]: east along +x (iso: right and down); frame the stand and
    // the first half of the taxi.
    await focusCity(page, { x: v0!.home.x + 24, y: v0!.home.y - 8 })
    await pm.settle(10)
    const capMs = ((fixture.airportDepartureInS as number) + 10) * 1000
    const w = await page.evaluate((cap) => {
      const api = window.__pm!
      const ev = api.core.events as unknown as {
        on(n: string, f: (p: { hub: string; count: number }) => void): unknown
        off(n: string, f: (p: { hub: string; count: number }) => void): unknown
      }
      const got: { count: number | null; tick: number | null } = {
        count: null,
        tick: null,
      }
      const fn = (p: { hub: string; count: number }): void => {
        if (p.hub !== 'airport' || got.count !== null) return
        got.count = p.count
        got.tick = api.core.state.tick
      }
      ev.on('hub:departure', fn)
      let ms = 0
      while (got.count === null && ms < cap) {
        api.advance(100)
        ms += 100
      }
      ev.off('hub:departure', fn)
      return { ok: got.count !== null, ms, count: got.count, tick: got.tick }
    }, capMs)
    console.log(`shots: plane-departure hub:departure ${JSON.stringify(w)}`)
    expect(w.ok, 'the first Airport clearance flies the plane').toBe(true)
    // The settle frames above ran the sim too: time it from the fixture tick.
    expect(((w.tick ?? 0) - (fixture.tick as number)) / 10).toBe(
      fixture.airportDepartureInS,
    )
    // 160 frames = 2.56 s of the 4-s out leg (t ≈ 0.64): past the climb's
    // start (t 0.4), before the fade (t 0.8).
    await pm.overlay(false)
    await pm.stamp('test')
    await pm.settle(160)
    const st = await hubState(page, 'airport')
    const v = await vesselAt(page, 'airport')
    const alpha = await page.evaluate(() => {
      const api = window.__pm!
      const row = api.data.map.hubs.find((x) => x.district === 'airport')!
      const city = api.game.scene.getScene('City') as unknown as {
        props: {
          region: string
          tile: readonly [number, number]
          img: { alpha: number } | null
        }[]
      }
      const p = city.props.find(
        (pv) =>
          pv.region === 'airport' &&
          pv.tile[0] === row.vessel.tile[0] &&
          pv.tile[1] === row.vessel.tile[1],
      )
      return p?.img?.alpha ?? null
    })
    console.log(`shots: plane-departure ${JSON.stringify({ st, v, alpha })}`)
    expect(st?.phase).toBe('out')
    expect(st!.t).toBeGreaterThan(0.5)
    expect(st!.t).toBeLessThan(0.8)
    expect(v?.visible).toBe(true)
    expect(alpha, 'full opacity before the fade').toBe(1)
    expect(v!.img!.x, 'the plane taxied east').toBeGreaterThan(v!.home.x)
    await pm.shot('plane-departure', 0)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('victory', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await pm.open(POLICY)
    const { fixture } = await loadFixture(page, pm, 'victory')
    await pm.settle(5)
    await quietHints(page)
    await pm.settle(11)
    // Real frames at 1× to the Golden Release's last delivery (3 s).
    const w = await framesUntil(
      page,
      'api.sim.victory === true',
      Math.ceil((((fixture.victoryInS as number) + 10) * 1000) / 16),
      1,
    )
    console.log(`shots: victory game:victory ${JSON.stringify(w)}`)
    expect(w.ok, 'game:victory').toBe(true)
    expect(await victoryCardUp(page, pm), 'the VictoryCard opens').toBe(true)
    await pm.settle(30)
    const ui = await questUi(page)
    const texts = await sceneTexts(page, 'HUD')
    console.log(
      `shots: victory ${JSON.stringify({ holds: ui.holds, victory: ui.victory, last: ui.last, texts: texts.filter((t) => /TYCOON|Tycoon|Day|Lv/.test(t)) })}`,
    )
    expect(ui.victory).toBe(true)
    expect(ui.holds).toContain('victory')
    expect(ui.last).toMatchObject({
      id: fixture.questId,
      templateId: 'golden_release',
      outcome: 'completed',
    })
    expect(texts).toContain('TYCOON')
    await expectInside(page, 'HUD', [
      'victory:continue',
      'victory:newGame',
      'victory:summary',
    ])
    await pm.shot(shotName('victory'), 20)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('title-tycoon', async ({ page, pm, consoleErrors }) => {
    phoneAndMinFit()
    await pm.open(POLICY)
    await page.evaluate(() => localStorage.clear())
    const { fixture } = await loadFixture(page, pm, 'victory')
    await pm.settle(5)
    const capMs = ((fixture.victoryInS as number) + 10) * 1000
    const w = await page.evaluate(
      (cap) => window.__pm!.waitEvent('game:victory', cap),
      capMs,
    )
    expect(w.ok, 'game:victory').toBe(true)
    // The HUD saves right after the victory tick (onVictory → saveSoon).
    await pm.settle(8)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem('pm.save.v2')
          if (!raw) return null
          const s = JSON.parse(raw) as {
            state: { economy: { victory: boolean }; level: { level: number } }
          }
          return `${s.state.level.level}:${String(s.state.economy.victory)}`
        }),
      )
      .toBe('5:true')
    // The Title (default flow) over the attract city, the save's Continue.
    await page.goto(BASE)
    await titleUp(page)
    await pm.freeze()
    await pm.settle(30)
    const texts = await sceneTexts(page, 'Title')
    const header = texts.find((t) => /^Day \d+ · /.test(t)) ?? null
    const cont = await sceneTarget(page, 'Title', 'title:continue')
    const width = await page.evaluate((h) => {
      type Obj = { text?: unknown; width?: number; list?: Obj[] }
      const t = window.__pm!.game.scene.getScene('Title') as unknown as {
        children: { list: Obj[] }
      }
      const find = (list: readonly Obj[]): number | null => {
        for (const o of list) {
          if (o.text === h) return o.width ?? null
          const inner = Array.isArray(o.list) ? find(o.list) : null
          if (inner !== null) return inner
        }
        return null
      }
      return find(t.children.list)
    }, header)
    console.log(
      `shots: title-tycoon ${JSON.stringify({ header, width, cont, texts })}`,
    )
    expect(header, 'the Continue line').not.toBeNull()
    expect(header!).toMatch(/^Day \d+ · \$[\d,]+ · (Lv 5 · )?Tycoon ✓$/)
    expect(cont, 'Continue is offered').not.toBeNull()
    expect(width, 'the line fits the button').not.toBeNull()
    expect(width!).toBeLessThanOrEqual(cont!.w)
    await pm.shot(shotName('title-tycoon'), 10)
    // The save was written on the victory tick, before Continue on the card:
    // Continue reopens the VictoryCard and its hold (final review, scenes #2).
    await tapTarget(page, pm, 'Title', 'title:continue')
    expect(
      await settleUntil(page, pm, () =>
        page.evaluate(() => {
          const sm = window.__pm!.game.scene
          return sm.isActive('HUD') && !sm.isActive('Title')
        }),
      ),
      'Continue brings the game up',
    ).toBe(true)
    expect(await victoryCardUp(page, pm), 'the VictoryCard reopens').toBe(true)
    const ui = await questUi(page)
    console.log(
      `shots: title-tycoon continue ${JSON.stringify({ holds: ui.holds, paused: ui.paused, victory: ui.victory })}`,
    )
    expect(ui.holds).toContain('victory')
    expect(ui.paused).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})
