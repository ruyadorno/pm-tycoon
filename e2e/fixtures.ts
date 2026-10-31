// Playwright fixtures (phaser4-notes.md §10, plan.md §6.9.3). The projects in
// playwright.config.ts already launch Chromium with the SwiftShader args and
// the iPhone 16 / desktop-column profiles; these fixtures add
//   - consoleErrors: every console.error + uncaught page error (auto);
//   - pm: helpers over window.__pm — open(url) waits for __pm.ready, the
//     frozen-clock helpers (freeze / advance / settle / step / stamp),
//     shot(name) = a `scale: 'device'` PNG in shots/ with the overlay hidden,
//     and tap(x, y) = a real touch/mouse tap at logical game px;
//   - titleUp(page) / gameUp(page) (build 2, B2 §5): the Title is up over
//     the attract city (or, with attract = false, the ?attract=0 Title), and
//     the player's game is in after Continue / New game (ready, HUD up, the
//     Title gone, no attract sim);
//   - questUi(page) (M7, design-m7 §6.3-§6.6): the quest slots as
//     __pm.quests() reads them and the HUD's QuestCard / QuestChip /
//     VictoryCard / QUEST COMPLETE stamp, its modal depth and holds; build 3
//     (M11): the open event card (__pm.events().open — a job card holds a
//     policy-less sim) and the sim tick;
//   - build 3 M12 (contract §9.1): eventUi(page) — the deck and the HUD's
//     EventCard / EventChip / EffectsCard / lost-life, game-over, victory
//     and quest cards / newspaper, holds, modal depth, the sim tick;
//     debugEvent (sim.debug.offerEvent), eventCardUp / eventCardDown (the
//     slide and the read-in guard waited out), deckOff (no automatic card
//     — shots and fixture loads only, never before a replay check) and
//     quietHints (the one-time hints done; moved here from shots.spec.ts).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, expect, type Page } from '@playwright/test'

export const SHOTS_DIR = 'shots'
export const READY_TIMEOUT_MS = 45_000

/**
 * Wait for the Title. `attract` (the default flow): over the running attract
 * city with its sim installed; false: just the Title scene (?attract=0).
 */
export async function titleUp(
  page: Page,
  attract = true,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  await page.waitForFunction(
    (a) => {
      const pm = window.__pm
      if (!pm || !pm.game.scene.isActive('Title')) return false
      if (!a) return true
      const city = pm.game.scene.getScene('City') as unknown as {
        attract?: boolean
      } | null
      return (
        pm.attractSim !== null &&
        pm.game.scene.isActive('City') &&
        city?.attract === true
      )
    },
    attract,
    { timeout: timeoutMs },
  )
}

/** After Continue / New game: ready, the HUD up, the Title gone, no attract sim. */
export async function gameUp(
  page: Page,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const pm = window.__pm
      if (!pm?.ready) return false
      const sm = pm.game.scene
      return (
        sm.isActive('City') &&
        sm.isActive('HUD') &&
        !sm.isActive('Title') &&
        pm.attractSim === null
      )
    },
    null,
    { timeout: timeoutMs },
  )
}

/** A quest slot as the e2e specs read it (a slice of the ViewSim's QuestView). */
export interface QuestSlotInfo {
  id: string
  templateId: string
  status: string
  kind: string
  name: string
  target: string | null
  goal: number
  /** The value last sent in quest:progress (the chip's count). */
  value: number
  ticksLeft: number | null
  route: { origin: string; dest: string } | null
  /** magicParcel only: the golden parcel's id. */
  parcelId: number | null
}

/** The sim's quest slots and the HUD's quest UI (M7). */
export interface QuestUi {
  offer: QuestSlotInfo | null
  active: QuestSlotInfo | null
  /** The newest history record. */
  last: { id: string; templateId: string; outcome: string } | null
  nextOfferInTicks: number | null
  victory: boolean
  card: {
    open: boolean
    mode: string | null
    questId: string | null
    title: string | null
    gold: boolean
    buttons: string[]
  }
  chip: {
    visible: boolean
    icon: string
    pulse: boolean
    barText: string
    label: string
    tone: string
  }
  victoryCard: boolean
  /** The QUEST COMPLETE stamp is on screen. */
  stamp: boolean
  modalDepth: number
  holds: string[]
  paused: boolean
  /** Build 3: the open event card (a job card holds a policy-less sim, B3 §6). */
  openCard: { eventId: string; kind: string; questId: string | null } | null
  /** The sim tick (a held sim does not move). */
  tick: number
}

export function questUi(page: Page): Promise<QuestUi> {
  return page.evaluate((): QuestUi => {
    const api = window.__pm!
    const qs = api.quests()
    const slot = (q: (typeof qs)['offer']): QuestSlotInfo | null =>
      q === null
        ? null
        : {
            id: q.id,
            templateId: q.templateId,
            status: q.status,
            kind: q.kind,
            name: q.name,
            target: q.target,
            goal: q.goal,
            value: q.emittedValue,
            ticksLeft: q.ticksLeft,
            route: q.route,
            parcelId:
              q.progress.kind === 'magicParcel' ? q.progress.parcelId : null,
          }
    const hud = api.game.scene.getScene('HUD') as unknown as {
      questCard: {
        isOpen: boolean
        mode: string | null
        questId: string | null
        model: { title: string; gold: boolean; buttons: string[] } | null
      }
      questChip: {
        current: {
          visible: boolean
          icon: string
          pulse: boolean
          barText: string
          label: string
          tone: string
        }
      }
      victoryCard: { isOpen: boolean }
      questStamp: unknown
      holds: Set<string>
      modalDepth(): number
    }
    const card = hud.questCard
    const m = card.model
    const c = hud.questChip.current
    const last = qs.history[qs.history.length - 1] ?? null
    const open = api.events().open
    return {
      offer: slot(qs.offer),
      active: slot(qs.active),
      last: last
        ? { id: last.id, templateId: last.templateId, outcome: last.outcome }
        : null,
      nextOfferInTicks: qs.nextOfferInTicks,
      victory: qs.victory,
      card: {
        open: card.isOpen,
        mode: card.mode,
        questId: card.questId,
        title: m?.title ?? null,
        gold: m?.gold ?? false,
        buttons: m ? [...m.buttons] : [],
      },
      chip: {
        visible: c.visible,
        icon: c.icon,
        pulse: c.pulse,
        barText: c.barText,
        label: c.label,
        tone: c.tone,
      },
      victoryCard: hud.victoryCard.isOpen,
      stamp: hud.questStamp !== null && hud.questStamp !== undefined,
      modalDepth: hud.modalDepth(),
      holds: [...hud.holds].toSorted(),
      paused: api.stepper.paused,
      openCard: open
        ? { eventId: open.eventId, kind: open.kind, questId: open.questId }
        : null,
      tick: api.sim.tick,
    }
  })
}

/**
 * M7: `sim.debug.offerQuest(templateId)` (the `?quest=` command — build 3: a
 * job card, which a policy-less sim holds on), then — unless `accept` is
 * false — `sim.quest.accept` on that offer (routed to the card's decideEvent):
 * the sim's own logged commands. Returns the quest id (asserts both
 * succeeded).
 */
export async function debugQuest(
  page: Page,
  templateId: string,
  accept = true,
): Promise<string> {
  const r = await page.evaluate(
    ([t, a]) => {
      const vs = window.__pm!.sim
      const o = vs.debug!.offerQuest(t as string)
      if (!o.ok) return { id: null, reason: `offer: ${o.reason}` }
      const id = vs.quests().offer?.id ?? null
      if (!a || id === null) return { id, reason: null }
      const res = vs.quest.accept(id)
      return { id, reason: res.ok ? null : `accept: ${res.reason}` }
    },
    [templateId, accept] as const,
  )
  expect(r.reason, `debug quest ${templateId}`).toBeNull()
  expect(r.id, `debug quest ${templateId} has an id`).not.toBeNull()
  return r.id!
}

/**
 * M7 shortcut to the Golden Release's end (shots and e2e only — a page
 * mutation, so __pm.replay() no longer matches): the active ultimate's
 * counters are set to its goal (60 delivered, all on time, no malware), so
 * the next quests step completes it — quest:completed, the victory ticker
 * line and game:victory, as in play. Sim-only (100-ms steps).
 */
export async function finishUltimate(
  page: Page,
): Promise<{ ok: boolean; day: number | null; tick: number }> {
  return page.evaluate(async () => {
    const api = window.__pm!
    const a = api.core.state.quests.active
    if (!a || a.progress.kind !== 'ultimate')
      throw new Error('finishUltimate: the Golden Release is not active')
    a.progress.delivered = a.goal
    a.progress.onTime = a.goal
    a.progress.malware = 0
    const w = await api.waitEvent('game:victory', 2_000)
    return { ok: w.ok, day: w.payload?.day ?? null, tick: api.sim.tick }
  })
}

/**
 * The one-time hints a fresh page would raise over a loaded mid-game fixture
 * or a fresh game are marked done, as a player of that run has seen them —
 * the tour skipped (its Skip tour), the first-flag funnel and the first-Toss
 * hint seen (the policy Tosses as the player) and the 30-minute summary offer
 * made (victory.json is past 30:00) — and any toast up is cleared, so nothing
 * covers the art. Every other HUD reaction (level stamp, paper, chips, quest
 * and event UI) is untouched. M12 (critique 12): the gold QuestCard auto-opens
 * only past the tour, so the event stack e2e calls this too (moved here from
 * shots.spec.ts).
 */
export async function quietHints(page: Page): Promise<void> {
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

/** An option of the open card as the e2e specs read it (OpenCardView.options). */
export interface EventOptionInfo {
  index: number
  label: string
  lines: string[]
  tones: string[]
  affordable: boolean
  danger: boolean
  default: boolean
}

/**
 * Build 3 M12 (B3 §3.4, §6): the sim's deck (__pm.events()) and the HUD's
 * EventCard / EventChip / EffectsCard / lost-life and game-over cards /
 * newspaper, its holds and modal depth, the stepper and the sim tick.
 */
export interface EventUi {
  open: {
    eventId: string
    kind: string
    title: string
    parentChoice: string | null
    questId: string | null
    options: EventOptionInfo[]
  } | null
  openedTick: number | null
  queue: number
  scheduled: number
  modifiers: {
    key: string
    line: string
    ticksLeft: number | null
    label: string
  }[]
  /** The newest history record. */
  last: { eventId: string; option: number | null; outcome: string } | null
  card: {
    open: boolean
    eventId: string | null
    openedTick: number | null
    mode: string | null
    h: number | null
    fits: boolean | null
    rect: { x: number; y: number; w: number; h: number } | null
  }
  pending: boolean
  chip: { visible: boolean; count: number; pulse: boolean }
  effects: boolean
  lost: boolean
  over: boolean
  victory: boolean
  questCard: boolean
  /** The newspaper's headline while one is on screen, else null. */
  paper: string | null
  /** Papers waiting in the HUD's queue (incl. the current one). */
  papersQueued: number
  holds: string[]
  modalDepth: number
  paused: boolean
  held: boolean
  tick: number
  money: number
  lives: number
}

export function eventUi(page: Page): Promise<EventUi> {
  return page.evaluate((): EventUi => {
    const api = window.__pm!
    const ev = api.events()
    const o = ev.open
    const hud = api.game.scene.getScene('HUD') as unknown as {
      eventCard: {
        isOpen: boolean
        eventId: string | null
        openedTick: number | null
        model: { h: number; mode: string; fits: boolean } | null
        rect: { x: number; y: number; w: number; h: number } | null
      }
      eventPending: boolean
      eventChip: {
        current: { visible: boolean; count: number; pulse: boolean }
      }
      effectsCard: { isOpen: boolean }
      lostCard: { isOpen(): boolean }
      overCard: { isOpen(): boolean }
      victoryCard: { isOpen: boolean }
      questCard: { isOpen: boolean }
      paper: {
        isVisible(): boolean
        current(): { headline: string } | null
        queue: { current: unknown; waiting: unknown[] }
      }
      holds: Set<string>
      modalDepth(): number
    }
    const last = ev.history[ev.history.length - 1] ?? null
    const c = hud.eventChip.current
    const q = hud.paper.queue
    return {
      open: o
        ? {
            eventId: o.eventId,
            kind: o.kind,
            title: o.title,
            parentChoice: o.parentChoice,
            questId: o.questId,
            options: o.options.map((x) => ({
              index: x.index,
              label: x.label,
              lines: x.lines.map((l) => l.text),
              tones: x.lines.map((l) => l.tone),
              affordable: x.affordable,
              danger: x.danger,
              default: x.default,
            })),
          }
        : null,
      openedTick: api.core.state.events.open?.openedTick ?? null,
      queue: ev.queue,
      scheduled: ev.scheduledCount,
      modifiers: ev.modifiers.map((m) => ({
        key: m.key,
        line: m.line,
        ticksLeft: m.ticksLeft,
        label: m.label,
      })),
      last: last
        ? { eventId: last.eventId, option: last.option, outcome: last.outcome }
        : null,
      card: {
        open: hud.eventCard.isOpen,
        eventId: hud.eventCard.eventId,
        openedTick: hud.eventCard.openedTick,
        mode: hud.eventCard.model?.mode ?? null,
        h: hud.eventCard.model?.h ?? null,
        fits: hud.eventCard.model?.fits ?? null,
        rect: hud.eventCard.rect,
      },
      pending: hud.eventPending,
      chip: { visible: c.visible, count: c.count, pulse: c.pulse },
      effects: hud.effectsCard.isOpen,
      lost: hud.lostCard.isOpen(),
      over: hud.overCard.isOpen(),
      victory: hud.victoryCard.isOpen,
      questCard: hud.questCard.isOpen,
      paper: hud.paper.isVisible()
        ? (hud.paper.current()?.headline ?? '')
        : null,
      papersQueued: (q.current !== null ? 1 : 0) + q.waiting.length,
      holds: [...hud.holds].toSorted(),
      modalDepth: hud.modalDepth(),
      paused: api.stepper.paused,
      held: api.core.held,
      tick: api.sim.tick,
      money: api.sim.money,
      lives: api.sim.lives,
    }
  })
}

/** `sim.debug.offerEvent(id)` (the ?event= command): opens (or queues) that deck card now (asserts ok). */
export async function debugEvent(page: Page, id: string): Promise<void> {
  const r = await page.evaluate(
    (eid) => window.__pm!.sim.debug!.offerEvent(eid),
    id,
  )
  expect(r, `debug event ${id}`).toMatchObject({ ok: true })
}

/** Settle in 8-frame hops until `cond` holds (max `frames`); fixtures.ts' own (warehouse.ts imports this module). */
async function settleFor(
  pm: PmHelpers,
  cond: () => Promise<boolean>,
  frames: number,
): Promise<boolean> {
  for (let n = 0; n < frames; n += 8) {
    if (await cond()) return true
    await pm.settle(8)
  }
  return cond()
}

/**
 * Settle until the HUD's EventCard shows (`eventId` when given), then 40
 * frames (640 ms) more: the 300-ms slide has landed and the read-in guards
 * have passed — EVENT_CARD_IN_MS, and EVENT_DANGER_IN_MS (600) for a red
 * option (review mobile-1: a press counts only if it LANDS past them) — so
 * its buttons take taps. Asserts.
 */
export async function eventCardUp(
  page: Page,
  pm: PmHelpers,
  eventId?: string,
  frames = 240,
): Promise<EventUi> {
  const ok = await settleFor(
    pm,
    async () => {
      const ui = await eventUi(page)
      return ui.card.open && (!eventId || ui.card.eventId === eventId)
    },
    frames,
  )
  if (!ok) console.log(`eventCardUp: ${JSON.stringify(await eventUi(page))}`)
  expect(ok, `the EventCard opens${eventId ? ` on ${eventId}` : ''}`).toBe(true)
  await pm.settle(40)
  return eventUi(page)
}

/** Settle until the HUD's EventCard is closed (asserts). */
export async function eventCardDown(
  page: Page,
  pm: PmHelpers,
): Promise<EventUi> {
  const ok = await settleFor(
    pm,
    async () => !(await eventUi(page)).card.open,
    120,
  )
  expect(ok, 'the EventCard closes').toBe(true)
  await pm.settle(4)
  return eventUi(page)
}

/**
 * Shots / fixture loads only, never before a replay check (a page
 * mutation): the deck makes no automatic card from now on —
 * nextDrawTick = DECK_OFF_TICK (the rescue goes with it) and the links
 * booked so far are dropped; a link a decision books later still opens (a
 * chain shot). Call it with no drawn card open: deciding a drawn card
 * resets nextDrawTick (M12 critique 22) — asserted.
 */
export async function deckOff(page: Page): Promise<void> {
  const open = await page.evaluate(() => {
    const ev = window.__pm!.core.state.events
    const o = ev.open
    ev.nextDrawTick = 1e12
    ev.scheduled.length = 0
    return o ? { eventId: o.eventId, drawn: o.drawn } : null
  })
  expect(open?.drawn ?? false, 'deckOff with no drawn card open').toBe(false)
}

export interface PmHelpers {
  /** page.goto(url), then wait for window.__pm.ready. */
  open(url: string): Promise<void>
  ready(timeoutMs?: number): Promise<void>
  freeze(): Promise<void>
  thaw(): Promise<void>
  /** Sim-only advance (no render). */
  advance(ms: number): Promise<void>
  /** n frames of 16 ms through TimeStep (update + render each). */
  settle(frames?: number): Promise<void>
  step(ms?: number): Promise<void>
  stamp(text: string): Promise<void>
  overlay(on: boolean): Promise<void>
  /**
   * Freeze, hide the overlay, pin the stamp, settle, then save
   * shots/<name>.png at device scale. Returns the path.
   */
  shot(name: string, settleFrames?: number): Promise<string>
  /**
   * A real tap at logical game px (x, y): canvas offset + `scale.zoom`
   * → CSS px, then a touch tap (touch profiles) or a mouse click.
   */
  tap(x: number, y: number): Promise<void>
}

function helpers(page: Page): PmHelpers {
  const call = async (fn: string, ...args: unknown[]): Promise<void> => {
    await page.evaluate(
      ([f, a]) => {
        const pm = window.__pm as unknown as Record<
          string,
          (...x: unknown[]) => unknown
        >
        pm[f as string]!(...(a as unknown[]))
      },
      [fn, args] as const,
    )
  }
  const h: PmHelpers = {
    async open(url) {
      await page.goto(url)
      await h.ready()
    },
    async ready(timeoutMs = READY_TIMEOUT_MS) {
      await page.waitForFunction(() => window.__pm?.ready === true, null, {
        timeout: timeoutMs,
      })
    },
    freeze: () => call('freeze'),
    thaw: () => call('thaw'),
    advance: (ms) => call('advance', ms),
    settle: (frames = 60) => call('settle', frames),
    step: (ms = 16) => call('step', ms),
    stamp: (text) => call('stamp', text),
    overlay: (on) => call('overlay', on),
    async shot(name, settleFrames = 20) {
      await h.freeze()
      await h.overlay(false)
      await h.stamp('test')
      await h.settle(settleFrames)
      mkdirSync(SHOTS_DIR, { recursive: true })
      const path = join(SHOTS_DIR, `${name}.png`)
      await page.screenshot({ path, scale: 'device' })
      return path
    },
    async tap(x, y) {
      const p = await page.evaluate(
        ([lx, ly]) => {
          const game = window.__pm!.game
          const r = game.canvas.getBoundingClientRect()
          const z = game.scale.zoom
          return {
            x: r.left + (lx! + 0.5) * z,
            y: r.top + (ly! + 0.5) * z,
            touch: navigator.maxTouchPoints > 0,
          }
        },
        [x, y] as const,
      )
      if (p.touch) await page.touchscreen.tap(p.x, p.y)
      else await page.mouse.click(p.x, p.y)
    },
  }
  return h
}

export const test = base.extend<{ consoleErrors: string[]; pm: PmHelpers }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
        // A frame asked of the wrong atlas (world vs interior, M5): Phaser
        // only warns "Texture.frame missing: … has no frame …" and draws
        // the atlas's first frame instead — a silent bug unless it fails here.
        else if (m.type() === 'warning' && /has no frame/.test(m.text()))
          errors.push(`warning: ${m.text()}`)
      })
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      await use(errors)
    },
    { auto: true },
  ],
  pm: async ({ page }, use) => {
    await use(helpers(page))
  },
})

export { expect }
