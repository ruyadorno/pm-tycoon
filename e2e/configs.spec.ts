// The shipped data configs on the production build (plan-build2 §8.7 task 3;
// docs/decisions.md M10 "Configs"):
//   - ?debug=1&config=tycoon → Title → New game: Boot plays tycoon.json's
//     `start` recipe (src/boot/configStart.ts) on the fresh game — level 5,
//     the six slots filled (desk 1, the four checkers, desk 2, two
//     inspectors each), the Sorter Arm, docks 2–3, 3 bikes / 2 vans / 3
//     trucks with drivers, money left — as logged tick-0 commands
//     (debugForceLevel, then player commands), so the replay matches; the
//     Golden Release is offered on the first tick and its card opens; the
//     game saves under pm.save.v2:cfg:tycoon only, and Continue resumes it
//     without playing the recipe again; the attract sim never gets it.
//   - ?debug=1&config=spicy still boots: its playtest-1 levers (malware,
//     decoys, Hold Bay cap 2 on L1-L2) and the build-2 late quest cadence
//     (the first offer at firstOfferDay, not the base day) apply, and it has
//     no start recipe (a plain L1 game).
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, gameUp, questUi, test, titleUp } from './fixtures.ts'
import { settleUntil, tapTarget } from './warehouse.ts'

const TYCOON_URL = '/?debug=1&config=tycoon&seed=7&audio=0'
const SPICY_URL = '/?debug=1&config=spicy&seed=7&audio=0&skipTitle=1&newGame=1'
const TYCOON_PATH = 'public/configs/tycoon.json'
const SPICY_PATH = 'public/configs/spicy.json'
/** src/boot/autosave.ts: SAVE_KEY + CONFIG_KEY_INFIX + the config name. */
const SAVE_KEY = 'pm.save.v2'
const TYCOON_SAVE_KEY = `${SAVE_KEY}:cfg:tycoon`
/** sim/types.ts TICKS_PER_DAY (one in-game day = 60 s at 10 ticks/s). */
const TICKS_PER_DAY = 600
/** What a player can dispatch (the recipe's steps after debugForceLevel). */
const PLAYER_KINDS = [
  'placeDesk',
  'buyMachine',
  'hire',
  'buyDock',
  'buyVehicle',
]

interface GameProbe {
  level: number
  slots: (string | null)[]
  crews: number[]
  holdStation: string | number | null
  docks: string[]
  fleet: { type: string; driver: boolean; state: string }[]
  balance: number
  startMoney: number
  log: { tick: number; kind: string; level?: number }[]
  stamp: string
  tick: number
}

function probeGame(page: Page): Promise<GameProbe> {
  return page.evaluate((): GameProbe => {
    const api = window.__pm!
    const s = api.core.state
    const node = (id: string) => s.lane.nodes.find((n) => n.id === id)
    return {
      level: s.level.level,
      slots: s.lane.slotNodeIds.map((id) => {
        const f = node(id)?.fixture
        if (!f) return null
        return f.kind === 'desk' ? `desk${f.index}` : f.checker.defId
      }),
      crews: s.lane.slotNodeIds.flatMap((id) => {
        const f = node(id)?.fixture
        return f?.kind === 'desk' ? [f.inspectorIds.length] : []
      }),
      holdStation: s.lane.holdStation.fixture,
      docks: s.lane.docks.map((d) => d.id),
      fleet: s.vehicles.map((v) => ({
        type: v.type,
        driver: v.driverId !== null,
        state: v.state,
      })),
      balance: s.economy.balance,
      startMoney: api.data.economy.startMoney,
      log: api.core.commandLog.map((e) => ({
        tick: e.tick,
        kind: e.cmd.kind,
        ...(e.cmd.kind === 'debugForceLevel' ? { level: e.cmd.level } : {}),
      })),
      stamp: String(api.game.registry.get('buildStamp') ?? ''),
      tick: s.tick,
    }
  })
}

test.describe('data configs (?config=, plan-build2 §8.7 task 3)', () => {
  test('?config=tycoon: New game starts at L5 with a full lane and fleet, the Golden Release offered; its own save', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    const tycoon = JSON.parse(readFileSync(TYCOON_PATH, 'utf8')) as {
      economy: { startMoney: number }
      start: { fleet: Record<string, number> }
    }
    await page.goto(TYCOON_URL)
    await page.evaluate(() => localStorage.clear())
    await page.goto(TYCOON_URL)
    await titleUp(page)
    const title = await page.evaluate(() => {
      const api = window.__pm!
      return {
        config: api.params.config,
        attractForced: api.attractSim!.commandLog.some(
          (e) => e.cmd.kind === 'debugForceLevel',
        ),
      }
    })
    expect(title.config).toBe('tycoon')
    expect(title.attractForced, 'the attract sim never plays the recipe').toBe(
      false,
    )

    await tapTarget(page, pm, 'Title', 'title:new-game')
    await gameUp(page)
    await pm.freeze()
    const g = await probeGame(page)
    console.log(
      `configs: tycoon New game ${JSON.stringify({ ...g, log: g.log.length })}`,
    )
    expect(g.stamp.endsWith(' cfg:tycoon')).toBe(true)
    expect(g.startMoney).toBe(tycoon.economy.startMoney)
    expect(g.level).toBe(5)
    expect(g.slots).toEqual([
      'desk1',
      'metal_detector',
      'shaky_shaker',
      'battery_checker',
      'xray',
      'desk2',
    ])
    expect(g.crews).toEqual([2, 2])
    expect(g.holdStation).toBe('sorter_arm')
    expect(g.docks).toEqual(['dock1', 'dock2', 'dock3'])
    const count = (t: string) => g.fleet.filter((v) => v.type === t).length
    expect({
      bike: count('bike'),
      van: count('van'),
      truck: count('truck'),
    }).toEqual(tycoon.start.fleet)
    expect(g.fleet.every((v) => v.driver && v.state !== 'inactive')).toBe(true)
    expect(g.balance).toBeGreaterThan(2_000)
    expect(g.balance).toBeLessThan(g.startMoney)
    expect(g.log[0]).toEqual({ tick: 0, kind: 'debugForceLevel', level: 5 })
    expect(g.log).toHaveLength(20)
    for (const e of g.log.slice(1)) {
      expect(e.tick).toBe(0)
      expect(PLAYER_KINDS).toContain(e.kind)
    }

    // The Golden Release: offered on the first tick, its card opens.
    if (g.tick === 0) await pm.advance(200)
    const offer = await page.evaluate(() => {
      const o = window.__pm!.quests().offer
      return o
        ? { id: o.id, templateId: o.templateId, ultimate: o.ultimate }
        : null
    })
    expect(offer).toMatchObject({
      templateId: 'golden_release',
      ultimate: true,
    })
    expect(
      await settleUntil(page, pm, async () => {
        const ui = await questUi(page)
        return ui.card.open && ui.card.questId === offer!.id
      }),
      'the Golden Release card opens',
    ).toBe(true)
    const ui = await questUi(page)
    console.log(`configs: tycoon offer card ${JSON.stringify(ui.card)}`)
    expect(ui.card.gold).toBe(true)
    await page.screenshot({ path: '.logs/configs-tycoon-offer.png' })
    expect(await page.evaluate(() => window.__pm!.replay().matches)).toBe(true)

    // Its own save key; Continue resumes it without a second recipe.
    const saved = await page.evaluate(
      ([cfgKey, baseKey]) => {
        window.dispatchEvent(new PageTransitionEvent('pagehide'))
        const raw = localStorage.getItem(cfgKey!)
        const p = raw
          ? (JSON.parse(raw) as { commandLog: { cmd: { kind: string } }[] })
          : null
        return {
          cfg: p ? p.commandLog.length : null,
          base: localStorage.getItem(baseKey!) !== null,
        }
      },
      [TYCOON_SAVE_KEY, SAVE_KEY] as const,
    )
    expect(saved).toEqual({ cfg: 20, base: false })
    await page.goto(TYCOON_URL)
    await titleUp(page)
    await tapTarget(page, pm, 'Title', 'title:continue')
    await gameUp(page)
    await pm.freeze()
    const resumed = await probeGame(page)
    expect(resumed.level).toBe(5)
    expect(resumed.log).toHaveLength(20)
    expect(resumed.fleet).toHaveLength(g.fleet.length)
    expect(resumed.tick).toBeGreaterThan(0)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('?config=spicy still boots: its levers and the late quest cadence apply, no start recipe', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    const spicy = JSON.parse(readFileSync(SPICY_PATH, 'utf8')) as {
      parcels: { malware: { baseShare: number }; decoyShare: number }
      levels: { holdBayCap: number }[]
      quests: { offer: { firstOfferDay: number; intervalDays: number } }
    }
    await pm.open(SPICY_URL)
    await pm.freeze()
    const got = await page.evaluate(() => {
      const api = window.__pm!
      return {
        baseShare: api.data.parcels.malware.baseShare,
        decoyShare: api.data.parcels.decoyShare,
        holdBayCaps: api.data.levels.map((l) => l.holdBayCap),
        offer: api.data.quests.offer,
        holdBayCap: api.sim.holdBay.cap,
        level: api.sim.level,
        vehicles: api.sim.vehicles.length,
        log: api.core.commandLog.length,
        tick: api.sim.tick,
        nextOfferTick: api.core.state.quests.nextOfferTick,
        stamp: String(api.game.registry.get('buildStamp') ?? ''),
      }
    })
    console.log(`configs: spicy ${JSON.stringify(got)}`)
    expect(got.stamp.endsWith(' cfg:spicy')).toBe(true)
    expect(got.baseShare).toBe(spicy.parcels.malware.baseShare)
    expect(got.decoyShare).toBe(spicy.parcels.decoyShare)
    expect(got.holdBayCaps.slice(0, spicy.levels.length)).toEqual(
      spicy.levels.map((l) => l.holdBayCap),
    )
    expect(got.holdBayCap).toBe(spicy.levels[0]!.holdBayCap)
    expect(got.offer.firstOfferDay).toBe(spicy.quests.offer.firstOfferDay)
    expect(got.offer.intervalDays).toBe(spicy.quests.offer.intervalDays)
    expect(got.level).toBe(1)
    expect(got.vehicles).toBe(0)
    expect(got.log).toBe(0)
    const firstOfferTick = spicy.quests.offer.firstOfferDay * TICKS_PER_DAY
    expect(got.nextOfferTick).toBe(firstOfferTick)

    // The first regular offer comes at firstOfferDay (1:00), not the base 3:00.
    await pm.advance((firstOfferTick - got.tick) * 100 + 200)
    const q = await page.evaluate(() => {
      const qs = window.__pm!.quests()
      return {
        tick: window.__pm!.sim.tick,
        offer: qs.offer ? qs.offer.offeredTick : null,
      }
    })
    expect(q.offer, 'an offer at firstOfferDay').toBe(firstOfferTick)
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})
