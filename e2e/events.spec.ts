// Event cards on screen (plan-build3 §8.3 task 5 + acceptance; B3 §3.2-§3.5,
// §6; M12 contract §9.2 with critique 11 and 12), iPhone 16 profile, the
// production bundle, no policy (a policy-less sim holds on an open card):
//   1. seed 7 with ?fastForward=300: the deck's first draw opens a card at
//      3:20 (tick 2000) and the fast-forward stops there; the EventCard shows
//      it under the 'event' hold (stepper paused) and the sim tick does not
//      move — frames or __pm.advance — until an option is tapped.
//   2. decide → effects: the grant's Apply adds $150, the history records the
//      decision, the command log ends with decideEvent, the ticker carries
//      `MONEY: Small-business grant` and a ≥ $100 decision runs its paper.
//   3. a news card (Rain) closes on a tap outside it (the city); its OK is
//      decided and the bikes' speed modifier is live.
//   4. the event chip then shows one effect (no pulse); its tap opens the
//      EffectsCard — `bikes ×0.85 speed` and `… left · Rain`; Close closes it.
//   5. the job card (?quest=rush_district): Accept activates the quest (the
//      commands are exactly debugOfferQuest, decideEvent); on a second page
//      Decline records `declined` and starts the day's cooldown.
//   6. a reload with a card open (the pagehide autosave) reopens it, held.
//   7. one-life.json + the recall: the strike is the red `danger` face with
//      `— this can end the run`, the fine greyed (balance $200 < $250); the
//      strike ends the run in the GameOverCard's event variant (`The recall —
//      you chose: Take the strike`), the lost-life card never shows.
//   8. the stack (R34): lost-life card × EventCard × papers × gold QuestCard
//      open and close in that order; then critique 12's legs — a card behind
//      the open gold card opens after Later; a card offered during the
//      level-up moment (debug level 5 with a job active) waits for it and its
//      papers, then opens though the Golden Release offer it brought is
//      blocked by the job (critique 3: never a frozen game).
//   9. review scenes-2 / mobile-1: the think clock (D-M15-5) stops while the
//      landscape rotate card covers the EventCard, and runs again upright.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import {
  debugEvent,
  debugQuest,
  eventCardDown,
  eventCardUp,
  eventUi,
  expect,
  questUi,
  quietHints,
  test,
  type EventUi,
  type PmHelpers,
} from './fixtures.ts'
import { sceneTarget, sceneTexts, settleUntil, tapTarget } from './warehouse.ts'

const BASE = '/?seed=7&debug=1&skipTitle=1&audio=0&attract=0'
const EV = (id: string): string => `${BASE}&event=${id}`
/** events.json schedule.firstEventS 200 s → the deck's first draw at tick 2000. */
const FIRST_DRAW_TICK = 2000
/** events.json schedule.jobCooldownDays (1) × 600 ticks a day. */
const DAY_TICKS = 600
const ENDS_RUN = '— this can end the run'

/** The command kinds of the current sim's log, oldest first. */
function commandKinds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    window.__pm!.core.commandLog.map((e) => e.cmd.kind),
  )
}

/** The option an answer takes: the default when affordable, else the first affordable one. */
function answerIndex(ui: EventUi): number {
  const opts = ui.open!.options.filter((o) => o.affordable)
  const pick = opts.find((o) => o.default) ?? opts[0]
  expect(pick, 'an affordable option').toBeTruthy()
  return pick!.index
}

/** Every ticker line the HUD holds: pending, scrolling and waiting. */
function tickerLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      pendingLines: { text: string }[]
      ticker: {
        queue: { current: { text: string } | null; waiting: { text: string }[] }
      }
    }
    const q = hud.ticker.queue
    return [
      ...(q.current ? [q.current.text] : []),
      ...q.waiting.map((w) => w.text),
      ...hud.pendingLines.map((l) => l.text),
    ]
  })
}

/** The HUD layout's canvas size (logical px). */
function hudSize(page: Page): Promise<{ W: number; H: number }> {
  return page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      L: { W: number; H: number }
    }
    return { W: hud.L.W, H: hud.L.H }
  })
}

/** The paper on screen once its 300-ms slide has landed under the frozen clock (asserts). */
async function paperUp(page: Page, pm: PmHelpers): Promise<string> {
  expect(
    await settleUntil(
      page,
      pm,
      async () => (await eventUi(page)).paper !== null,
      400,
    ),
    'a newspaper comes up',
  ).toBe(true)
  await pm.settle(24)
  return (await eventUi(page)).paper!
}

/** Tap the papers away (OK) until none is up or queued; their headlines in order. */
async function readPapers(page: Page, pm: PmHelpers): Promise<string[]> {
  const seen: string[] = []
  for (let i = 0; i < 8; i++) {
    const ui = await eventUi(page)
    if (ui.paper === null && ui.papersQueued === 0) break
    seen.push(await paperUp(page, pm))
    await tapTarget(page, pm, 'HUD', 'newspaper:ok')
    await pm.settle(24)
  }
  return seen
}

/** The level-up moment the event gate waits on (HudScene.eventGate levelMoment). */
function levelMoment(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
      paperHoldMs: number
      levelAnim: unknown
    }
    return hud.paperHoldMs > 0 || hud.levelAnim !== null
  })
}

/** The lifecycle invariants at rest (lifecycle.spec.ts expectAtRest, the HUD's part). */
async function expectAtRest(page: Page, label: string): Promise<void> {
  const inv = await page.evaluate(() => {
    const api = window.__pm!
    const sm = api.game.scene
    const hud = sm.getScene('HUD') as unknown as {
      holds: Set<string>
      modalDepth(): number
      eventCard: { isOpen: boolean }
      questCard: { isOpen: boolean }
      effectsCard: { isOpen: boolean }
    }
    const city = sm.getScene('City') as unknown as {
      transitioning: boolean
      vehicles: Map<number, unknown>
      cameras: { main: { fadeEffect: { isRunning: boolean } } }
    }
    return {
      holds: [...hud.holds],
      paused: api.stepper.paused,
      held: api.core.held,
      modalDepth: hud.modalDepth(),
      cards: [
        hud.eventCard.isOpen,
        hud.questCard.isOpen,
        hud.effectsCard.isOpen,
      ],
      city: sm.isActive('City') && !sm.isSleeping('City'),
      cityTransitioning: city.transitioning,
      cityFade: city.cameras.main.fadeEffect.isRunning,
      vehicleViews: city.vehicles.size,
      simVehicles: api.core.state.vehicles.length,
    }
  })
  expect(inv.holds, `${label}: no hold left`).toEqual([])
  expect(inv.paused, `${label}: the stepper runs`).toBe(false)
  expect(inv.held, `${label}: the sim is not held`).toBe(false)
  expect(inv.modalDepth, `${label}: modal stack empty`).toBe(0)
  expect(inv.cards, `${label}: no card up`).toEqual([false, false, false])
  expect(inv.city, `${label}: City awake`).toBe(true)
  expect(inv.cityTransitioning, `${label}: City accepts input`).toBe(false)
  expect(inv.cityFade, `${label}: no camera fade`).toBe(false)
  expect(inv.vehicleViews, `${label}: one view per vehicle`).toBe(
    inv.simVehicles,
  )
}

test.describe('M12 event cards', () => {
  test('a card opens at 3:20 on seed 7 (?fastForward=300) and the sim tick stops until a tap', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(`${BASE}&fastForward=300`)
    await pm.freeze()
    const ui = await eventCardUp(page, pm)
    console.log(
      `events: first draw ${JSON.stringify({ open: ui.open, openedTick: ui.openedTick, tick: ui.tick, card: ui.card, holds: ui.holds })}`,
    )
    expect(ui.open, 'the deck drew a card').not.toBeNull()
    expect(ui.card).toMatchObject({ open: true, eventId: ui.open!.eventId })
    expect(ui.holds).toContain('event')
    expect(ui.paused, 'the hold stops the stepper').toBe(true)
    expect(ui.held, 'the sim holds itself').toBe(true)
    expect(ui.openedTick!).toBeGreaterThanOrEqual(FIRST_DRAW_TICK)
    expect(ui.openedTick!).toBeLessThan(FIRST_DRAW_TICK + 10)
    // The fast-forward stopped at the tick that opened the card.
    const t = ui.tick
    expect(t).toBe(ui.openedTick)
    await pm.settle(30)
    expect(
      await page.evaluate(() => window.__pm!.advance(10_000)),
      'advance runs no tick under the hold',
    ).toBe(0)
    expect((await eventUi(page)).tick, 'frames and advance: no tick').toBe(t)
    await tapTarget(page, pm, 'HUD', `event:opt${answerIndex(ui)}`)
    const down = await eventCardDown(page, pm)
    expect(down.open, 'the tap decided the card').toBeNull()
    expect(down.holds).not.toContain('event')
    await pm.settle(10)
    expect((await eventUi(page)).tick, 'decided: the sim runs').toBeGreaterThan(
      t,
    )
    expect(await commandKinds(page)).toContain('decideEvent')
    expect(await page.evaluate(() => window.__pm!.replay().matches)).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('decide → effects applied, the history, the decideEvent command, the ticker line and the paper', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    // debug.offerEvent on the running game (not ?event=, which offers it in
    // Boot before the HUD hears the card's ticker line).
    await pm.open(BASE)
    await pm.freeze()
    await pm.settle(5)
    await debugEvent(page, 'ev_money_grant')
    const ui = await eventCardUp(page, pm, 'ev_money_grant')
    expect(ui.open!.options.map((o) => o.label)).toEqual(['Apply', 'Skip'])
    expect(ui.open!.options[0]!.lines).toEqual(['+$150'])
    expect(ui.card.mode).toBe('decision')
    const ticker = await tickerLines(page)
    console.log(`events: ticker ${JSON.stringify(ticker)}`)
    expect(ticker).toContain('MONEY: Small-business grant')
    await tapTarget(page, pm, 'HUD', 'event:opt0')
    const down = await eventCardDown(page, pm)
    expect(down.money, '+$150').toBe(ui.money + 150)
    expect(down.last).toEqual({
      eventId: 'ev_money_grant',
      option: 0,
      outcome: 'decided',
    })
    const kinds = await commandKinds(page)
    expect(kinds.at(-1)).toBe('decideEvent')
    expect(
      await page.evaluate(() => window.__pm!.core.commandLog.at(-1)!.cmd),
    ).toEqual({ kind: 'decideEvent', eventId: 'ev_money_grant', option: 0 })
    // ≥ $100: the decision's one-line paper (B3 §3.4).
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await eventUi(page)).paper !== null,
        60,
      ),
      'the paper comes up within 60 frames',
    ).toBe(true)
    const paper = (await eventUi(page)).paper!
    console.log(`events: grant paper "${paper}"`)
    expect(paper).toContain('Small-business grant')
    expect(await page.evaluate(() => window.__pm!.replay().matches)).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('review scenes-2 / mobile-1: no think time while the rotate card covers the EventCard', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(BASE)
    await pm.freeze()
    await pm.settle(5)
    await debugEvent(page, 'ev_money_grant')
    await eventCardUp(page, pm, 'ev_money_grant')
    await pm.thaw()
    const probe = (): Promise<{
      shown: boolean
      thinkMs: number | null
      rotate: boolean
      holds: string[]
    }> =>
      page.evaluate(() => {
        const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
          recorder: {
            deps: { cardShown(): unknown }
            r: { card: { thinkMs: number } | null }
          }
          rotate: { isOpen(): boolean }
          holds: Set<string>
        }
        return {
          shown: hud.recorder.deps.cardShown() !== null,
          thinkMs: hud.recorder.r.card?.thinkMs ?? null,
          rotate: hud.rotate.isOpen(),
          holds: [...hud.holds].toSorted(),
        }
      })
    await page.waitForTimeout(300)
    expect(await probe()).toMatchObject({ shown: true, rotate: false })
    const vp = page.viewportSize()!
    await page.setViewportSize({ width: vp.height, height: vp.width })
    await expect.poll(async () => (await probe()).rotate).toBe(true)
    const covered = await probe()
    expect(covered.shown, 'cardShown under the rotate card').toBe(false)
    expect(covered.holds).toEqual(['event', 'rotate'])
    await page.waitForTimeout(2000)
    const after = await probe()
    console.log(
      `events: think ms behind the rotate card ${JSON.stringify({ covered: covered.thinkMs, after: after.thinkMs })}`,
    )
    expect(after.thinkMs, 'no think time behind the rotate card').toBe(
      covered.thinkMs,
    )
    await page.setViewportSize(vp)
    await expect.poll(async () => (await probe()).rotate).toBe(false)
    await page.waitForTimeout(500)
    const upright = await probe()
    expect(upright.shown, 'cardShown upright').toBe(true)
    expect(upright.thinkMs!, 'the clock runs again').toBeGreaterThan(
      after.thinkMs!,
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('review mobile-1/-2: a press that lands while the card slides in never decides it, however late it lifts; a city select under the card opens no district panel', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(BASE)
    await pm.freeze()
    await pm.settle(5)
    await debugEvent(page, 'ev_money_grant')
    // Catch the card mid-slide: its buttons live (one frame after the open
    // they join the input list) and the Back ease crossing the resting y
    // (~110 ms in, before its overshoot), well inside the 300-ms guard.
    type Slide = { open: boolean; dt: number; dy: number }
    const slideNow = (): Promise<Slide> =>
      page.evaluate((): Slide => {
        const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
          time: { now: number }
          eventCard: {
            isOpen: boolean
            openedAt: number
            root: { y: number }
            rect: { y: number } | null
          }
        }
        const c = hud.eventCard
        return {
          open: c.isOpen,
          dt: hud.time.now - c.openedAt,
          dy: c.rect ? c.rect.y - c.root.y : 0,
        }
      })
    let at: Slide = { open: false, dt: 0, dy: 0 }
    for (let i = 0; i < 40; i++) {
      await pm.settle(1)
      at = await slideNow()
      if (at.open && at.dt >= 64 && Math.abs(at.dy) <= 12) break
    }
    console.log(`events: mobile-1 press at ${JSON.stringify(at)}`)
    expect(at.open, 'the EventCard opens').toBe(true)
    expect(at.dt, 'the press lands inside the read-in guard').toBeLessThan(250)
    expect(
      Math.abs(at.dy),
      'the card is near its resting y',
    ).toBeLessThanOrEqual(12)
    // `Skip`'s resting centre: its live rect shifted by the slide still to go.
    const slide = at.dy
    const r = await sceneTarget(page, 'HUD', 'event:opt1')
    expect(r, 'the Skip button is live').not.toBeNull()
    const css = await page.evaluate(
      ([lx, ly]) => {
        const game = window.__pm!.game
        const b = game.canvas.getBoundingClientRect()
        const z = game.scale.zoom
        return { x: b.left + (lx! + 0.5) * z, y: b.top + (ly! + 0.5) * z }
      },
      [
        r!.x + Math.floor(r!.w / 2),
        r!.y + Math.floor(r!.h / 2) + slide,
      ] as const,
    )
    const decides = async (): Promise<number> =>
      (await commandKinds(page)).filter((k) => k === 'decideEvent').length
    const before = await decides()
    const cdp = await page.context().newCDPSession(page)
    try {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [css],
      })
      await pm.settle(2)
      // The finger is on Skip (its pressed face): on the old guard, read at
      // the lift, this press decided the card.
      const face = await page.evaluate(() => {
        const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
          eventCard: { root: { list: { id?: string; visual?: string }[] } }
        }
        return (
          hud.eventCard.root.list.find((o) => o.id === 'event:opt1')?.visual ??
          null
        )
      })
      expect(face, 'the press landed on Skip').toBe('down')
      // Held 480 ms in all: it lifts well past the 300-ms guard.
      await pm.settle(28)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      })
      await pm.settle(4)
    } finally {
      await cdp.detach()
    }
    let ui = await eventUi(page)
    expect(ui.card.open, 'the card is still up, undecided').toBe(true)
    expect(ui.holds).toContain('event')
    expect(await decides()).toBe(before)
    // Review mobile-2: the City's select (a long-press under way when the
    // card opened fires from CityScene.update) opens no panel under it.
    await page.evaluate(() =>
      window.__pm!.game.events.emit('pm:select', {
        kind: 'district',
        id: 'downtown',
      }),
    )
    await pm.settle(4)
    const district = await page.evaluate(() => {
      const hud = window.__pm!.game.scene.getScene('HUD') as unknown as {
        district: { isOpen(): boolean } | null
      }
      return hud.district?.isOpen() ?? false
    })
    expect(district, 'no district panel under the card').toBe(false)
    ui = await eventUi(page)
    expect(ui.modalDepth).toBe(1)
    // A press that lands once the card is in answers it.
    await tapTarget(page, pm, 'HUD', 'event:opt1')
    const down = await eventCardDown(page, pm)
    expect(down.last).toEqual({
      eventId: 'ev_money_grant',
      option: 1,
      outcome: 'decided',
    })
    expect(await decides()).toBe(before + 1)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('a news card closes on any tap; then the chip opens the EffectsCard with the timed modifier and its time left', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(EV('ev_wx_rain'))
    await pm.freeze()
    const ui = await eventCardUp(page, pm, 'ev_wx_rain')
    expect(ui.open!.kind).toBe('news')
    expect(ui.card.mode).toBe('news')
    expect(ui.holds).toContain('event')
    // A tap on the city, well outside the card (the scrim's outside tap).
    const { W } = await hudSize(page)
    expect(ui.card.rect!.y, 'the tap lands above the card').toBeGreaterThan(130)
    await pm.tap(Math.floor(W / 2), 120)
    const down = await eventCardDown(page, pm)
    console.log(
      `events: rain ${JSON.stringify({ last: down.last, modifiers: down.modifiers, chip: down.chip })}`,
    )
    expect(down.last).toEqual({
      eventId: 'ev_wx_rain',
      option: 0,
      outcome: 'decided',
    })
    expect(down.open).toBeNull()
    expect(down.modifiers).toEqual([
      expect.objectContaining({
        key: 'speed',
        line: 'bikes ×0.85 speed',
        label: 'Rain',
      }),
    ])
    expect(down.holds).toEqual([])

    // 4. The chip: one live effect, no pending card (no pulse).
    await pm.settle(10)
    expect((await eventUi(page)).chip).toEqual({
      visible: true,
      count: 1,
      pulse: false,
    })
    await tapTarget(page, pm, 'HUD', 'eventChip')
    expect(
      await settleUntil(page, pm, async () => (await eventUi(page)).effects),
      'the EffectsCard opens',
    ).toBe(true)
    await pm.settle(24)
    const texts = await sceneTexts(page, 'HUD')
    console.log(
      `events: effects card ${JSON.stringify(texts.filter((t) => /speed|left|active|Rain/.test(t)))}`,
    )
    expect(texts.some((t) => /bikes ×0\.85 speed/.test(t))).toBe(true)
    expect(texts.some((t) => /^(1d 0h|2[0-3]h) left · Rain$/.test(t))).toBe(
      true,
    )
    const open = await eventUi(page)
    expect(open.modalDepth).toBe(1)
    expect(open.holds, 'the EffectsCard never holds').toEqual([])
    await tapTarget(page, pm, 'HUD', 'effects:close')
    expect(
      await settleUntil(page, pm, async () => !(await eventUi(page)).effects),
      'Close closes it',
    ).toBe(true)
    expect((await eventUi(page)).modalDepth).toBe(0)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('the job card (?quest=rush_district): Accept activates the quest — debugOfferQuest, decideEvent', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(`${BASE}&quest=rush_district`)
    await pm.freeze()
    const ui = await eventCardUp(page, pm, 'job:rush_district')
    console.log(`events: job card ${JSON.stringify(ui.open)}`)
    expect(ui.open!.kind).toBe('job')
    expect(ui.card.mode).toBe('job')
    expect(ui.open!.options.map((o) => o.label)).toEqual(['Accept', 'Decline'])
    expect(ui.holds).toContain('event')
    expect(ui.paused).toBe(true)
    const texts = await sceneTexts(page, 'HUD')
    expect(texts).toContain('Rush hour')
    await tapTarget(page, pm, 'HUD', 'event:opt0')
    await eventCardDown(page, pm)
    await pm.settle(8)
    const q = await questUi(page)
    expect(q.active?.templateId).toBe('rush_district')
    expect(q.offer).toBeNull()
    expect(q.chip).toMatchObject({ visible: true, barText: '0/6' })
    expect(await commandKinds(page)).toEqual(['debugOfferQuest', 'decideEvent'])
    const t = q.tick
    await pm.settle(30)
    expect((await eventUi(page)).tick, 'the sim runs').toBeGreaterThan(t)
    expect(await page.evaluate(() => window.__pm!.replay().matches)).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('the job card: Decline records it and starts the day-long cooldown', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(`${BASE}&quest=rush_district`)
    await pm.freeze()
    await eventCardUp(page, pm, 'job:rush_district')
    await tapTarget(page, pm, 'HUD', 'event:opt1')
    await eventCardDown(page, pm)
    await pm.settle(8)
    const q = await questUi(page)
    console.log(
      `events: declined ${JSON.stringify(q.last)} next in ${q.nextOfferInTicks}`,
    )
    expect(q.offer).toBeNull()
    expect(q.active).toBeNull()
    expect(q.last).toMatchObject({
      templateId: 'rush_district',
      outcome: 'declined',
    })
    expect(q.chip.visible).toBe(false)
    // jobCooldownDays 1 from the decline tick (the 8 frames since run ~1 tick).
    expect(q.nextOfferInTicks!).toBeGreaterThanOrEqual(DAY_TICKS - 10)
    expect(await commandKinds(page)).toEqual(['debugOfferQuest', 'decideEvent'])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('a reload with a card open (the pagehide autosave) reopens it, held', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    // The gold crate: three options on a new game (the scanner course needs
    // two inspectors for its third since M14).
    await pm.open(EV('ev_sec_crate'))
    await pm.freeze()
    const ui = await eventCardUp(page, pm, 'ev_sec_crate')
    expect(ui.card.mode, 'three options').toBe('three')
    const tick = ui.tick
    await pm.thaw()
    // No ?seed= / ?event=: Boot resumes the autosave the pagehide wrote.
    await pm.open('/?debug=1&skipTitle=1&audio=0&attract=0')
    await pm.freeze()
    const back = await eventCardUp(page, pm, 'ev_sec_crate')
    console.log(
      `events: after the reload ${JSON.stringify({ open: back.open?.eventId, tick: back.tick, holds: back.holds })}`,
    )
    expect(back.open?.eventId).toBe('ev_sec_crate')
    expect(back.openedTick).toBe(ui.openedTick)
    expect(back.tick).toBe(tick)
    expect(back.holds).toContain('event')
    expect(back.held).toBe(true)
    await pm.settle(30)
    expect((await eventUi(page)).tick, 'still held').toBe(tick)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('one-life.json + the recall: the strike (danger, `this can end the run`) → the GameOverCard event variant', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(BASE)
    await pm.freeze()
    const text = readFileSync('tests/fixtures/one-life.json', 'utf8')
    const fx = JSON.parse(text) as { dataHash: string }
    expect(fx.dataHash, 'one-life.json is stale: run `vlr fixtures`').toBe(
      await page.evaluate(() => window.__pm!.data.hash),
    )
    await page.evaluate((json) => window.__pm!.load(json), text)
    // Critique 11: the fixture's draw is not due (tick 2189, nextDrawTick
    // 2910) — no card on the load.
    const loaded = await page.evaluate(() => {
      const s = window.__pm!.core.state
      return {
        open: s.events.open,
        tick: s.tick,
        next: s.events.nextDrawTick,
        lives: s.economy.lives,
        balance: s.economy.balance,
      }
    })
    console.log(`events: one-life loaded ${JSON.stringify(loaded)}`)
    expect(loaded.open).toBeNull()
    expect(loaded.next).toBeGreaterThan(loaded.tick)
    expect(loaded.lives).toBe(1)
    await debugEvent(page, 'ev_sec_recall')
    const ui = await eventCardUp(page, pm, 'ev_sec_recall')
    console.log(`events: the recall ${JSON.stringify(ui.open!.options)}`)
    const [fine, strike] = ui.open!.options
    expect(fine!.affordable, `the fine is greyed at $${loaded.balance}`).toBe(
      loaded.balance >= 250,
    )
    expect(strike!.label).toBe('Take the strike')
    expect(strike!.danger).toBe(true)
    expect(strike!.lines.at(-1)!.endsWith(ENDS_RUN)).toBe(true)
    const card = await sceneTexts(page, 'HUD')
    expect(card.some((t) => t.endsWith(ENDS_RUN))).toBe(true)
    let lostSeen = false
    await tapTarget(page, pm, 'HUD', 'event:opt1')
    const over = await settleUntil(
      page,
      pm,
      async () => {
        const u = await eventUi(page)
        lostSeen ||= u.lost
        return u.over
      },
      240,
    )
    expect(over, 'the GameOverCard opens').toBe(true)
    await pm.settle(20)
    const end = await eventUi(page)
    lostSeen ||= end.lost
    const texts = await sceneTexts(page, 'HUD')
    console.log(
      `events: game over ${JSON.stringify({ lives: end.lives, holds: end.holds, texts: texts.filter((t) => /recall|GAME|over/i.test(t)) })}`,
    )
    expect(texts).toContain('The recall — you chose: Take the strike')
    expect(lostSeen, 'the lost-life card never showed').toBe(false)
    expect(end.lives).toBe(0)
    expect(end.card.open).toBe(false)
    expect(end.holds).toContain('gameOver')
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('the stack (R34): lost-life card → EventCard → papers → gold QuestCard, in order; then a card behind the gold card, a blocked gold offer, the level-up moment', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    test.setTimeout(150_000)
    await pm.open(BASE)
    await pm.freeze()
    await pm.settle(5)
    // Critique 12: the gold card auto-opens only past the tour.
    await quietHints(page)
    await pm.settle(5)

    // 1. A malware delivery: the lost-life card after its 600-ms lead-in.
    await page.evaluate(() => window.__pm!.sim.debug!.forceMalwareDelivery())
    expect(
      await settleUntil(page, pm, async () => (await eventUi(page)).lost),
      'the lost-life card opens',
    ).toBe(true)
    await pm.settle(20)
    let ui = await eventUi(page)
    expect(ui.holds).toEqual(['lostLife'])
    expect(ui.modalDepth).toBe(1)

    // 2. A card arrives under it: it waits (the sim holds itself), the chip pulses.
    await debugEvent(page, 'ev_money_grant')
    await pm.settle(10)
    ui = await eventUi(page)
    console.log(`events: stack 2 ${JSON.stringify(ui)}`)
    expect(ui.open?.eventId).toBe('ev_money_grant')
    expect(ui.card.open, 'the card waits behind the lost-life card').toBe(false)
    expect(ui.pending).toBe(true)
    expect(ui.chip).toMatchObject({ visible: true, pulse: true })
    expect(ui.held).toBe(true)

    // 3. Continue: the lost-life card closes, the EventCard opens.
    await tapTarget(page, pm, 'HUD', 'lostLife:continue')
    ui = await eventCardUp(page, pm, 'ev_money_grant')
    expect(ui.lost).toBe(false)
    expect(ui.holds).toEqual(['event'])
    expect(ui.modalDepth).toBe(1)
    expect(ui.paper, 'the incident paper waits behind the card').toBeNull()

    // 4. Apply: the card closes; the papers (incident, then grant) in turn.
    await tapTarget(page, pm, 'HUD', 'event:opt0')
    await eventCardDown(page, pm)
    const papers = await readPapers(page, pm)
    console.log(`events: stack papers ${JSON.stringify(papers)}`)
    expect(papers.length).toBeGreaterThanOrEqual(2)
    expect(papers.at(-1)).toContain('Small-business grant')
    expect(papers[0]).not.toContain('Small-business grant')

    // 5. The Golden Release offer: its gold card opens (no hold), Accept.
    await debugQuest(page, 'golden_release', false)
    expect(
      await settleUntil(page, pm, async () => (await eventUi(page)).questCard),
      'the gold QuestCard opens',
    ).toBe(true)
    await pm.settle(30)
    ui = await eventUi(page)
    expect((await questUi(page)).card).toMatchObject({ gold: true })
    expect(ui.modalDepth).toBe(1)
    expect(ui.holds).toEqual([])

    // Critique 12 leg a: a card arriving behind the open gold card waits,
    // then opens once the gold card closes (Later).
    await debugEvent(page, 'ev_wx_rain')
    await pm.settle(10)
    ui = await eventUi(page)
    expect(ui.questCard, 'the gold card stays up').toBe(true)
    expect(ui.card.open, 'the card waits behind the gold card').toBe(false)
    expect(ui.pending).toBe(true)
    await tapTarget(page, pm, 'HUD', 'quest:later')
    ui = await eventCardUp(page, pm, 'ev_wx_rain')
    expect(ui.questCard).toBe(false)
    expect(ui.holds).toEqual(['event'])
    expect(ui.modalDepth).toBe(1)
    await tapTarget(page, pm, 'HUD', 'event:opt0')
    await eventCardDown(page, pm)
    await pm.settle(10)

    // The gold offer is still standing: its chip reopens the card; Accept.
    await tapTarget(page, pm, 'HUD', 'questChip')
    expect(
      await settleUntil(page, pm, async () => (await eventUi(page)).questCard),
      'the chip reopens the gold card',
    ).toBe(true)
    await pm.settle(30)
    await tapTarget(page, pm, 'HUD', 'quest:accept')
    expect(
      await settleUntil(page, pm, async () => !(await eventUi(page)).questCard),
      'Accept closes the gold card',
    ).toBe(true)
    await pm.settle(10)
    expect((await questUi(page)).active?.templateId).toBe('golden_release')
    expect((await eventUi(page)).modalDepth).toBe(0)
    await readPapers(page, pm)
    await pm.settle(10)
    await expectAtRest(page, 'after the stack')
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('R34 legs: a card drawn in the level-up moment waits for it, then opens though the Golden Release offer is blocked (a job active)', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    test.setTimeout(150_000)
    await pm.open(BASE)
    await pm.freeze()
    await pm.settle(5)
    await quietHints(page)
    // A job accepted, then level 5 (debug): the Golden Release is offered
    // on the level-up tick beside the active job — blocked, so its card
    // cannot open and must never go first (critique 3) — and the level-up
    // moment starts.
    await debugQuest(page, 'rush_district')
    await pm.settle(10)
    expect(
      await page.evaluate(
        () => window.__pm!.dispatch({ kind: 'debugForceLevel', level: 5 }).ok,
      ),
    ).toBe(true)
    expect(
      await settleUntil(page, pm, () => levelMoment(page), 40),
      'the level-up moment starts',
    ).toBe(true)
    // The offer comes on the next tick (quests step 11).
    await pm.settle(8)
    let q = await questUi(page)
    console.log(
      `events: blocked gold ${JSON.stringify({ offer: q.offer?.templateId, active: q.active?.templateId, card: q.card })}`,
    )
    expect(q.offer?.templateId).toBe('golden_release')
    expect(q.active?.templateId).toBe('rush_district')
    expect(q.card.open, 'the blocked gold card does not open').toBe(false)

    // A card offered during the moment waits for it.
    await debugEvent(page, 'ev_money_grant')
    await pm.settle(8)
    let ui = await eventUi(page)
    expect(await levelMoment(page), 'still in the moment').toBe(true)
    expect(ui.card.open, 'the card waits through the level-up moment').toBe(
      false,
    )
    expect(ui.pending).toBe(true)
    expect(ui.held).toBe(true)
    // The moment ends (stamp, then its papers — a visible paper is the one
    // other thing a pending card waits for): the card opens after it, and
    // the blocked gold offer never keeps it waiting.
    const order: string[] = []
    for (let i = 0; i < 120; i++) {
      ui = await eventUi(page)
      if (ui.card.open) break
      const m = await levelMoment(page)
      const now = m ? 'moment' : ui.paper !== null ? 'paper' : 'free'
      if (order.at(-1) !== now) order.push(now)
      if (now === 'paper') {
        await pm.settle(24)
        if (await sceneTarget(page, 'HUD', 'newspaper:ok'))
          await tapTarget(page, pm, 'HUD', 'newspaper:ok')
      }
      await pm.settle(8)
    }
    console.log(`events: level-up leg ${JSON.stringify(order)}`)
    ui = await eventCardUp(page, pm, 'ev_money_grant')
    expect(order[0]).toBe('moment')
    expect(await levelMoment(page), 'the moment is over').toBe(false)
    expect(ui.holds).toEqual(['event'])
    expect(ui.questCard, 'the blocked gold card stays closed').toBe(false)
    await tapTarget(page, pm, 'HUD', 'event:opt1')
    ui = await eventCardDown(page, pm)
    expect(ui.held).toBe(false)
    q = await questUi(page)
    expect(q.active?.templateId).toBe('rush_district')
    expect(q.offer?.templateId).toBe('golden_release')
    const t = ui.tick
    await pm.settle(30)
    expect((await eventUi(page)).tick, 'the sim runs on').toBeGreaterThan(t)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})
