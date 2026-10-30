// Quests (plan-build2 §8.4 tasks 4 + 6, design-m7 §6.3-§6.6, §6.10, §7
// "e2e/quests.spec.ts"), iPhone 16 profile, the production bundle:
//   - ?quest=rush_district on a fresh game: Boot offers it (debugOfferQuest,
//     the first logged command) and the HUD opens its QuestCard at create —
//     `Rush hour`, Accept · Later · Decline, on the modal stack, the sim
//     running (no hold). A real Accept tap → the card closes, the chip shows
//     `0/6` + time left and __pm.quests().active is the quest; a chip tap
//     opens the active card (Abandon · Close); Esc closes it.
//   - Later keeps the offer (the chip pulses `New job`; a chip tap reopens
//     the card); Decline clears it (history `declined`, the next offer in one
//     day = 600 ticks).
//   - Esc on an offer is Later; Abandon asks first (the Dialog), then frees
//     the slot with no penalty (history `abandoned`, the next offer in two
//     days).
//   - debug.offerQuest('magic_parcel') + Accept under the policy: the golden
//     parcel spawns at A at once (magic, size S, waiting there), the city
//     marks A and B (`ic_magic` + ring), the chip shows `ic_magic` + the
//     m:ss clock, and the checkers wave it through (trace `skipped`).
//   - the Golden Release by debug (finishUltimate sets its counters to the
//     goal): game:victory holds the sim ('victory'), the VictoryCard opens
//     after the stamp; Continue releases the hold and the sim runs on
//     (endless, economy.victory).
import type { Page } from '@playwright/test'
import {
  debugQuest,
  expect,
  finishUltimate,
  questUi,
  test,
  type PmHelpers,
  type QuestUi,
} from './fixtures.ts'
import { settleUntil, tapTarget } from './warehouse.ts'

const BASE = '/?seed=7&debug=1&skipTitle=1&audio=0&attract=0'
const QUEST_URL = `/?quest=rush_district&seed=7&debug=1&skipTitle=1&audio=0&attract=0`
const POLICY_URL = `${BASE}&policy=1`
/** quests.json offer.declineCooldownDays / intervalDays × 600 ticks. */
const DAY_TICKS = 600

/** Settle until the QuestCard shows `mode` (asserts). */
async function cardUp(
  page: Page,
  pm: PmHelpers,
  mode: 'offer' | 'active' | 'complete',
): Promise<QuestUi> {
  expect(
    await settleUntil(page, pm, async () => {
      const ui = await questUi(page)
      return ui.card.open && ui.card.mode === mode
    }),
    `the QuestCard opens in ${mode} mode`,
  ).toBe(true)
  await pm.settle(20) // the 300-ms slide-in; buttons join the input list
  return questUi(page)
}

/** Settle until the QuestCard is closed (asserts). */
async function cardDown(page: Page, pm: PmHelpers): Promise<QuestUi> {
  expect(
    await settleUntil(page, pm, async () => !(await questUi(page)).card.open),
    'the QuestCard closes',
  ).toBe(true)
  await pm.settle(4)
  return questUi(page)
}

/** The command kinds of the current sim's log, oldest first. */
function commandKinds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    window.__pm!.core.commandLog.map((e) => e.cmd.kind),
  )
}

/** The ?quest= offer is up in its card (fresh game, frozen clock). */
async function openQuestGame(page: Page, pm: PmHelpers): Promise<QuestUi> {
  await pm.open(QUEST_URL)
  await pm.freeze()
  const ui = await cardUp(page, pm, 'offer')
  console.log(`quests: boot offer ${JSON.stringify(ui.offer)}`)
  expect(ui.offer).toMatchObject({
    templateId: 'rush_district',
    status: 'offered',
    kind: 'deliveriesFrom',
    name: 'Rush hour',
    goal: 6,
  })
  expect(ui.offer!.target, 'the rush targets a district').not.toBeNull()
  expect(ui.card).toMatchObject({
    open: true,
    mode: 'offer',
    questId: ui.offer!.id,
    title: 'Rush hour',
    gold: false,
    buttons: ['accept', 'later', 'decline'],
  })
  expect(ui.modalDepth, 'the card is on the modal stack').toBe(1)
  expect(ui.holds, 'the card never holds the sim').toEqual([])
  expect(ui.paused).toBe(false)
  expect(await commandKinds(page)).toEqual(['debugOfferQuest'])
  return ui
}

test.describe('M7 quests', () => {
  test('?quest= opens the offer; Accept → the chip + __pm.quests().active; the chip reopens it; Esc closes', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    const boot = await openQuestGame(page, pm)
    const t0 = await page.evaluate(() => window.__pm!.sim.tick)
    // The card does not pause the sim (design-m7 Q19).
    await pm.settle(30)
    expect(await page.evaluate(() => window.__pm!.sim.tick)).toBeGreaterThan(t0)
    expect((await questUi(page)).chip).toMatchObject({
      visible: true,
      pulse: true,
      barText: 'New job',
    })

    await tapTarget(page, pm, 'HUD', 'quest:accept')
    let ui = await cardDown(page, pm)
    console.log(
      `quests: accepted ${JSON.stringify(ui.active)} chip ${JSON.stringify(ui.chip)}`,
    )
    expect(ui.offer).toBeNull()
    expect(ui.active).toMatchObject({
      id: boot.offer!.id,
      templateId: 'rush_district',
      status: 'active',
      target: boot.offer!.target,
    })
    expect(ui.chip).toMatchObject({
      visible: true,
      icon: 'ic_quest',
      pulse: false,
      barText: '0/6',
    })
    // limitDays 3 from the accept tick: `2d 23h`-ish.
    expect(ui.chip.label).toMatch(/^(\dd \d{1,2}h|\d{1,2}h|<1h)$/)
    expect(ui.modalDepth).toBe(0)
    expect(await commandKinds(page)).toEqual(['debugOfferQuest', 'acceptQuest'])

    // A real tap on the chip: the active card (Abandon · Close).
    await tapTarget(page, pm, 'HUD', 'questChip')
    ui = await cardUp(page, pm, 'active')
    expect(ui.card).toMatchObject({
      questId: boot.offer!.id,
      title: 'Rush hour',
      buttons: ['abandon', 'close'],
    })
    await page.keyboard.press('Escape')
    ui = await cardDown(page, pm)
    expect(ui.active?.id, 'Esc only closes the card').toBe(boot.offer!.id)
    expect(ui.modalDepth).toBe(0)
    expect(ui.holds).toEqual([])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('Later keeps the offer (the chip pulses, a chip tap reopens it); Decline clears it', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    const boot = await openQuestGame(page, pm)
    await tapTarget(page, pm, 'HUD', 'quest:later')
    let ui = await cardDown(page, pm)
    expect(ui.offer?.id, 'Later keeps the offer').toBe(boot.offer!.id)
    expect(ui.active).toBeNull()
    expect(ui.chip).toMatchObject({
      visible: true,
      pulse: true,
      barText: 'New job',
    })
    expect(ui.modalDepth).toBe(0)
    // Later never reopens the card by itself.
    await pm.settle(60)
    expect((await questUi(page)).card.open).toBe(false)

    await tapTarget(page, pm, 'HUD', 'questChip')
    ui = await cardUp(page, pm, 'offer')
    expect(ui.card.questId).toBe(boot.offer!.id)
    await tapTarget(page, pm, 'HUD', 'quest:decline')
    ui = await cardDown(page, pm)
    console.log(
      `quests: declined ${JSON.stringify(ui.last)} next in ${ui.nextOfferInTicks}`,
    )
    expect(ui.offer).toBeNull()
    expect(ui.active).toBeNull()
    expect(ui.last).toEqual({
      id: boot.offer!.id,
      templateId: 'rush_district',
      outcome: 'declined',
    })
    expect(ui.chip.visible, 'the chip hides with no quest').toBe(false)
    // declineCooldownDays 1, counted from the decline tick.
    expect(ui.nextOfferInTicks).toBeGreaterThan(DAY_TICKS - 30)
    expect(ui.nextOfferInTicks).toBeLessThanOrEqual(DAY_TICKS)
    expect(await commandKinds(page)).toEqual([
      'debugOfferQuest',
      'declineQuest',
    ])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('Esc on an offer is Later; Abandon asks first, then frees the slot with no penalty', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    const boot = await openQuestGame(page, pm)
    await page.keyboard.press('Escape')
    let ui = await cardDown(page, pm)
    expect(ui.offer?.id, 'Esc = Later: the offer stays').toBe(boot.offer!.id)

    await tapTarget(page, pm, 'HUD', 'questChip')
    await cardUp(page, pm, 'offer')
    await tapTarget(page, pm, 'HUD', 'quest:accept')
    ui = await cardDown(page, pm)
    expect(ui.active?.id).toBe(boot.offer!.id)
    const money = await page.evaluate(() => window.__pm!.sim.money)

    await tapTarget(page, pm, 'HUD', 'questChip')
    await cardUp(page, pm, 'active')
    await tapTarget(page, pm, 'HUD', 'quest:abandon')
    await pm.settle(16)
    // The confirm Dialog first: `Keep going` changes nothing …
    await tapTarget(page, pm, 'HUD', 'quest:abandonConfirm:cancel')
    await pm.settle(16)
    ui = await questUi(page)
    expect(ui.active?.id, 'Keep going keeps the quest').toBe(boot.offer!.id)
    expect(ui.card.open, 'the card stays open under the Dialog').toBe(true)
    // … `Abandon` ends it.
    await tapTarget(page, pm, 'HUD', 'quest:abandon')
    await pm.settle(16)
    await tapTarget(page, pm, 'HUD', 'quest:abandonConfirm:confirm')
    ui = await cardDown(page, pm)
    console.log(
      `quests: abandoned ${JSON.stringify(ui.last)} next in ${ui.nextOfferInTicks}`,
    )
    expect(ui.active).toBeNull()
    expect(ui.last).toEqual({
      id: boot.offer!.id,
      templateId: 'rush_district',
      outcome: 'abandoned',
    })
    expect(ui.chip.visible).toBe(false)
    // intervalDays 2 after an abandon; no penalty (Q-B2-7).
    expect(ui.nextOfferInTicks).toBeGreaterThan(2 * DAY_TICKS - 30)
    expect(ui.nextOfferInTicks).toBeLessThanOrEqual(2 * DAY_TICKS)
    expect(await page.evaluate(() => window.__pm!.sim.money)).toBe(money)
    expect(ui.modalDepth).toBe(0)
    expect(await commandKinds(page)).toEqual([
      'debugOfferQuest',
      'acceptQuest',
      'abandonQuest',
    ])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('a magic offer: Accept spawns the golden parcel at A, the city marks A and B, checkers skip it', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(POLICY_URL)
    await pm.freeze()
    // The policy's opening bike (a servable district for the route).
    await page.evaluate(() => window.__pm!.advance(40_000))
    await pm.settle(30)
    const id = await debugQuest(page, 'magic_parcel')
    await pm.settle(8)
    const ui = await questUi(page)
    console.log(
      `quests: magic ${JSON.stringify(ui.active)} chip ${JSON.stringify(ui.chip)}`,
    )
    expect(ui.active).toMatchObject({ id, kind: 'magicParcel', goal: 1 })
    const route = ui.active!.route!
    expect(route, 'the accepted magic quest has a route').not.toBeNull()
    expect(route.origin).not.toBe(route.dest)
    const parcel = await page.evaluate((pid) => {
      const api = window.__pm!
      const p = api.core.state.parcels[pid]
      return p
        ? {
            magic: p.magic,
            size: p.size,
            malware: p.malware,
            state: p.state,
            origin: p.origin,
            dest: p.dest,
          }
        : null
    }, ui.active!.parcelId!)
    expect(parcel).toMatchObject({
      magic: true,
      size: 'S',
      malware: false,
      origin: route.origin,
      dest: route.dest,
    })
    expect(
      await page.evaluate(() => window.__pm!.core.state.spawn.magicAlive),
    ).toBe(1)
    expect(ui.chip).toMatchObject({
      visible: true,
      icon: 'ic_magic',
      barText: '',
    })
    expect(ui.chip.label).toMatch(/^[12]:\d\d$/)
    const marks = await page.evaluate(
      ([a, b]) => {
        const city = window.__pm!.game.scene.getScene('City') as unknown as {
          buildings: Map<string, { magic: boolean }>
        }
        const on = [...city.buildings.entries()]
          .filter(([, v]) => v.magic)
          .map(([k]) => k)
          .toSorted()
        return {
          a: city.buildings.get(a!)?.magic,
          b: city.buildings.get(b!)?.magic,
          on,
        }
      },
      [route.origin, route.dest] as const,
    )
    expect(marks, 'ic_magic over A and B only').toEqual({
      a: true,
      b: true,
      on: [route.origin, route.dest].toSorted(),
    })
    // Until it is delivered: the checkers wave it through (never flagged).
    const run = await page.evaluate((pid) => {
      const api = window.__pm!
      const ev = api.core.events as unknown as {
        on(
          n: string,
          f: (p: { id?: number; parcelId?: number }) => void,
        ): unknown
        off(
          n: string,
          f: (p: { id?: number; parcelId?: number }) => void,
        ): unknown
      }
      const flagged: number[] = []
      const fn = (p: { id?: number; parcelId?: number }): void => {
        const x = p.parcelId ?? p.id
        if (x === pid) flagged.push(x)
      }
      ev.on('parcel:flagged', fn)
      let steps = 0
      // The parcel is collected after delivery: keep its last trace.
      let trace: string[] = []
      const done = (): boolean => api.quests().active === null
      while (!done() && steps < 1300) {
        api.advance(100)
        steps++
        const p = api.core.state.parcels[pid]
        if (p) trace = p.trace.map((t) => t.what)
      }
      ev.off('parcel:flagged', fn)
      return {
        flagged: flagged.length,
        steps,
        trace,
        last: api.quests().history.at(-1) ?? null,
      }
    }, ui.active!.parcelId!)
    console.log(`quests: magic run ${JSON.stringify(run)}`)
    expect(run.flagged).toBe(0)
    expect(run.trace, 'a checker waved it through').toContain('skipped')
    expect(run.trace, 'never held').not.toContain('held')
    expect(run.last?.id).toBe(id)
    expect(run.last?.outcome, 'the policy delivers it within 120 s').toBe(
      'completed',
    )
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('the Golden Release: game:victory holds the sim, the VictoryCard opens; Continue releases it', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await pm.open(POLICY_URL)
    await pm.freeze()
    await page.evaluate(() => window.__pm!.advance(40_000))
    await pm.settle(30)
    const id = await debugQuest(page, 'golden_release')
    await pm.settle(8) // the HUD re-reads quests() on its next frame
    let ui = await questUi(page)
    expect(ui.active).toMatchObject({ id, kind: 'ultimate', goal: 60 })
    expect(ui.chip.barText).toMatch(/^\d+\/60$/)
    const w = await finishUltimate(page)
    console.log(`quests: victory ${JSON.stringify(w)}`)
    expect(w.ok, 'game:victory fires').toBe(true)
    ui = await questUi(page)
    expect(ui.victory).toBe(true)
    expect(ui.last).toMatchObject({ id, outcome: 'completed' })
    expect(ui.holds, 'game:victory holds the sim at once').toContain('victory')
    expect(
      await settleUntil(
        page,
        pm,
        async () => (await questUi(page)).victoryCard,
      ),
      'the VictoryCard opens after the stamp',
    ).toBe(true)
    await pm.settle(20)
    ui = await questUi(page)
    expect(ui.paused, 'the VictoryCard pauses').toBe(true)
    const tick = await page.evaluate(() => window.__pm!.sim.tick)
    await pm.settle(20)
    expect(await page.evaluate(() => window.__pm!.sim.tick)).toBe(tick)
    await tapTarget(page, pm, 'HUD', 'victory:continue')
    await pm.settle(20)
    ui = await questUi(page)
    expect(ui.victoryCard).toBe(false)
    expect(ui.holds).toEqual([])
    expect(ui.paused).toBe(false)
    expect(ui.modalDepth).toBe(0)
    await pm.settle(30)
    expect(
      await page.evaluate(() => window.__pm!.sim.tick),
      'endless: the sim runs on after Continue',
    ).toBeGreaterThan(tick)
    expect(await page.evaluate(() => window.__pm!.sim.victory)).toBe(true)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})
