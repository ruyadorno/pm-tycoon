// window.__pm — the debug / test API (plan.md §5, §6.8; phaser4-notes.md
// §10). Installed by Boot when import.meta.env.DEV || ?debug=1. The clock
// helpers drive TimeStep (not Game) so input, scene clocks, tweens and timers
// all see one synthetic clock:
//   freeze()  = loop.sleep(); loop.smoothStep = false (exact deltas);
//               tweens follow the stepped clock too (installTweenClock)
//   step(ms)  = loop.step(loop.now + ms): one update + render
//   settle(n) = n x step(16)
//   thaw()    = loop.smoothStep = true; loop.wake()
//   advance(ms[, answer]) = stepper.advance(ms): sim only, no render, uncapped
// `sim` is the ViewSim facade (what scenes use: rush, debug.*), `core` the
// raw Sim (state, commandLog, dispatch). Both follow setSim() swaps.
// `audio` is the AudioDirector's debug surface (audio.md §9.2: state(), log,
// unlock(), sfx(name), hook(event, payload), chord(), renderWav(bars, parts?,
// fromBar?), mute(m?), director), read from registry 'audio' (Boot creates the
// director before this API exists; disabled under ?audio=0, still present).
// `ready` flips after Core READY + the CREATE of the world scene ?view=
// selects (City by default, Warehouse, Gallery).
// Build 2 / M5 (B2 §5): `attractSim` is the Title's attract Sim while it is
// installed (null once Continue / New game swapped in the player's — so
// `core !== attractSim` proves the swap), and `ready` waits for the City to
// leave attract mode (pm:attractEnd) when the City was created under the
// Title's attract tour. debugLotCorners(on) marks the lot footprint's four
// iso corners in the City (the city-lot-zoom2 shot).
// M4 (plan.md §12.7 task 1, §12.9): playtest() is the live playtest profile
// (the HUD's PlaytestRecorder, registry REG_PLAYTEST; null before the HUD
// exists), downloadPlaytest() saves it as playtest.json (the summary card's
// Blob + <a download>), and metrics().playtest carries its live counters
// (M15, v3: `cards` {offered, decided, thinkMedianS} too).
// M7 (design-m7 §6.10, plan-build2 §8.4 task 6): quests() is the ViewSim's
// quests() (offer / active slots with their derived fields, history,
// vouchers, victory) — a plain-data read for e2e; the debug offer is
// `sim.debug.offerQuest(id)` (Boot's ?quest=<id> calls it).
// Build 3 (B3 §3.4, §6; M11): events() is the ViewSim's events() (the open
// card, the queue, links, history, live modifiers); a card holds a sim with
// no policy, so answerCard() decides the open card's default (a logged
// decideEvent — the replay still matches) and advance(ms, true) /
// waitEvent(name, cap, true) answer every card they meet on the way, for
// policy-less runs that must cross a draw (fixtures, long waits). M12: the
// HUD shows the open card as its EventCard; an answer from here closes it on
// the next frame (event:decided → its refreshEvents) and releases its
// 'event' hold. The debug offer is `sim.debug.offerEvent(id)` (Boot's
// ?event=<id> calls it).
import Phaser from 'phaser'
import type { AudioDebugApi, AudioDirector } from '../audio/director.ts'
import type { Stepper } from '../boot/stepper.ts'
import { REG, setSim } from '../boot/simBinding.ts'
import { EV_ATTRACT_END, EV_GOTO, type WorldView } from '../boot/nav.ts'
import type { GameData } from '../data/index.ts'
import {
  PLAYTEST_FILE,
  REG_PLAYTEST,
  type Playtest,
  type PlaytestRecorder,
} from '../metrics/playtest.ts'
import type { Command, CommandResult } from '../sim/commands.ts'
import type { SimEventName, SimEventPayloads } from '../sim/events.ts'
import { replay, Sim, stateHash, type SimSnapshot } from '../sim/sim.ts'
import type { EventsView, QuestsView, ViewSim } from '../sim/view-api.ts'
import { downloadJson } from '../ui/SummaryCard.ts'
import { installDrawCallCounter, overlayStats, REG_OVERLAY } from './overlay.ts'
import { type Params, worldSceneKey } from './params.ts'

export interface WaitResult<K extends SimEventName = SimEventName> {
  ok: boolean
  name: K
  /** Sim ms advanced while waiting (100-ms steps). */
  waitedMs: number
  payload: SimEventPayloads[K] | null
}

export interface PmMetrics {
  fps: number
  tick: number
  sprites: number
  drawCalls: number
  simMsPerTick: number
  money: number
  lifetimeEarned: number
  level: number
  lives: number
  deliveries: number
  malware: { spawned: number; caught: number; missed: number }
  minutes: unknown[]
  /** The playtest profile's live counters (null before the HUD exists). */
  playtest: {
    elapsedS: number
    simS: number
    pausedS: number
    taps: number
    tapsPerMin: number
    viewSwitches: number
    warehouseS: number
    fps: Playtest['fps']
    /** v3 (M15): the cards so far (state counters) and the median think time. */
    cards: { offered: number; decided: number; thinkMedianS: number | null }
  } | null
}

export interface ReplayResult {
  hash: string
  liveHash: string
  matches: boolean
  ticks: number
  commands: number
}

export interface PmApi {
  game: Phaser.Game
  /** The ViewSim facade of the current sim. */
  readonly sim: ViewSim
  /** The raw Sim (state, commandLog, dispatch). */
  readonly core: Sim
  /** The Title's attract Sim while installed (B2 §5), else null. */
  readonly attractSim: Sim | null
  readonly seed: number
  readonly stepper: Stepper
  readonly data: GameData
  readonly params: Params
  ready: boolean
  freeze(): void
  thaw(): void
  step(ms?: number): void
  /**
   * Sim-only advance (no render); the ticks run. `answer`: decide every open
   * card on the way with answerCard() (a held sim otherwise stays put).
   */
  advance(ms: number, answer?: boolean): number
  settle(frames?: number): void
  stamp(text: string): void
  goto(view: WorldView): void
  /** Advance in 100-ms steps until `name` fires or `capMs`; `answer` as advance's. */
  waitEvent<K extends SimEventName>(
    name: K,
    capMs?: number,
    answer?: boolean,
  ): Promise<WaitResult<K>>
  snapshot(): SimSnapshot
  load(json: string | SimSnapshot): void
  metrics(): PmMetrics
  dispatch(cmd: Command): CommandResult
  replay(): ReplayResult
  /** Show / hide the debug overlay (screenshots); returns the new state. */
  overlay(on?: boolean): boolean
  /** Set the stepper speed (0, 1, 2, 4). */
  speed(s: 0 | 1 | 2 | 4): void
  /** The AudioDirector's debug API (audio.md §9.2); undefined only before Boot made the director. */
  readonly audio: AudioDebugApi | undefined
  /** The live playtest profile (plan.md §12.9); null before the HUD exists. */
  playtest(): Playtest | null
  /** Save the live profile as playtest.json; false when there is none or it failed. */
  downloadPlaytest(): boolean
  /**
   * Mark (true) / clear (false) the lot footprint's four iso corners in the
   * City (B2 §6.1 check); returns the new state (false without a City).
   */
  debugLotCorners(on?: boolean): boolean
  /** M7: the current sim's quest slots, history, vouchers and victory (ViewSim.quests()). */
  quests(): QuestsView
  /** Build 3: the current sim's event deck (ViewSim.events()). */
  events(): EventsView
  /**
   * Build 3: decide the open card, if any — its default option when shown
   * and affordable, else the first such one — through ViewSim.event.decide
   * (a logged command). Returns the card's eventId, or null with none open.
   */
  answerCard(): string | null
}

declare global {
  interface Window {
    __pm?: PmApi
  }
}

/** metrics().playtest: the profile's live counters. */
function playtestCounters(pt: Playtest | null): PmMetrics['playtest'] {
  if (!pt) return null
  return {
    elapsedS: pt.elapsedS,
    simS: pt.simS,
    pausedS: pt.pausedS,
    taps: pt.taps,
    tapsPerMin: pt.tapsPerMin,
    viewSwitches: pt.viewSwitches,
    warehouseS: pt.warehouseS,
    fps: pt.fps,
    cards: {
      offered: pt.events.offered,
      decided: pt.events.decided,
      thinkMedianS: pt.events.thinkMedianS,
    },
  }
}

export const WAIT_STEP_MS = 100
export const WAIT_CAP_MS = 60_000

/** The option answerCard() takes: the default when shown and affordable, else the first such one. */
function answerOf(view: EventsView): { eventId: string; index: number } | null {
  const open = view.open
  if (!open) return null
  const ok = open.options.filter((o) => o.affordable)
  const pick = ok.find((o) => o.default) ?? ok[0]
  return pick ? { eventId: open.eventId, index: pick.index } : null
}

type TweenClock = { getDelta(tick?: boolean): number }

/**
 * Phaser 4.2.1's TweenManager times itself with Date.now() (getDelta,
 * src:tweens/TweenManager.js), not the TimeStep, so under freeze() + step()
 * tweens crawled at wall-clock speed (a 250 ms sheet slide was caught
 * half-way, the HUD money counter lagged the sim). While frozen every
 * manager's delta is the stepped frame's delta instead; thawed, Phaser's own
 * clock (with its lag smoothing) takes over again.
 */
function installTweenClock(loop: Phaser.Core.TimeStep): (on: boolean) => void {
  const proto = Phaser.Tweens.TweenManager.prototype as unknown as TweenClock
  const wallClock = proto.getDelta
  let frozen = false
  proto.getDelta = function (this: TweenClock, tick?: boolean): number {
    return frozen ? loop.delta : wallClock.call(this, tick)
  }
  return (on) => {
    frozen = on
  }
}

export function installDebugApi(
  game: Phaser.Game,
  stepper: Stepper,
  p: Params,
): PmApi {
  const loop = game.loop
  const core = (): Sim => game.registry.get(REG.sim) as Sim
  const data = (): GameData => game.registry.get(REG.data) as GameData
  installDrawCallCounter(game)
  const tweenClock = installTweenClock(loop)
  let audioApi: { of: AudioDirector; api: AudioDebugApi } | null = null
  const recorder = (): PlaytestRecorder | null =>
    (game.registry.get(REG_PLAYTEST) as PlaytestRecorder | undefined) ?? null
  const viewSim = (): ViewSim => game.registry.get(REG.viewSim) as ViewSim
  const answerCard = (): string | null => {
    const vs = viewSim()
    const a = answerOf(vs.events())
    if (!a) return null
    vs.event.decide(a.eventId, a.index)
    return a.eventId
  }
  /** stepper.advance(ms), answering each card met (100-ms steps) when asked. */
  const advanceBy = (ms: number, answer: boolean): number => {
    if (!answer) return stepper.advance(ms)
    let ticks = 0
    for (let left = ms; left > 0; left -= WAIT_STEP_MS) {
      answerCard()
      ticks += stepper.advance(Math.min(WAIT_STEP_MS, left))
    }
    return ticks
  }

  const pm: PmApi = {
    game,
    get sim() {
      return game.registry.get(REG.viewSim) as ViewSim
    },
    get core() {
      return core()
    },
    get attractSim() {
      return (game.registry.get(REG.attractSim) as Sim | null) ?? null
    },
    get seed() {
      return core().state.seed
    },
    get stepper() {
      return stepper
    },
    get data() {
      return data()
    },
    get params() {
      return p
    },
    get audio() {
      // registry 'audio' = BootScene REG_AUDIO (not imported: Boot imports this module)
      const dir = game.registry.get('audio') as AudioDirector | undefined
      if (!dir?.debugApi) return undefined
      if (audioApi?.of !== dir) audioApi = { of: dir, api: dir.debugApi() }
      return audioApi.api
    },
    ready: false,
    freeze() {
      loop.sleep()
      loop.smoothStep = false
      tweenClock(true)
    },
    thaw() {
      tweenClock(false)
      loop.smoothStep = true
      loop.wake()
    },
    step(ms = 16) {
      loop.step(loop.now + ms)
    },
    advance(ms: number, answer = false) {
      return advanceBy(ms, answer)
    },
    settle(frames = 60) {
      for (let i = 0; i < frames; i++) loop.step(loop.now + 16)
    },
    stamp(text: string) {
      game.registry.set(REG.buildStamp, text)
    },
    goto(view: WorldView) {
      game.events.emit(EV_GOTO, { view })
    },
    waitEvent<K extends SimEventName>(
      name: K,
      capMs = WAIT_CAP_MS,
      answer = false,
    ) {
      const sim = core()
      const got: { fired: boolean; payload: SimEventPayloads[K] | null } = {
        fired: false,
        payload: null,
      }
      const fn = (pl: unknown): void => {
        if (got.fired) return
        got.fired = true
        got.payload = pl as SimEventPayloads[K]
      }
      const ev = sim.events as unknown as {
        on(n: string, f: (pl: unknown) => void): unknown
        off(n: string, f: (pl: unknown) => void): unknown
      }
      ev.on(name, fn)
      let waited = 0
      try {
        while (!got.fired && waited < capMs) {
          advanceBy(WAIT_STEP_MS, answer)
          waited += WAIT_STEP_MS
        }
      } finally {
        ev.off(name, fn)
      }
      return Promise.resolve({
        ok: got.fired,
        name,
        waitedMs: waited,
        payload: got.payload,
      })
    },
    snapshot() {
      return core().snapshot()
    },
    load(json: string | SimSnapshot) {
      const snap = (
        typeof json === 'string' ? JSON.parse(json) : json
      ) as SimSnapshot
      setSim(game, Sim.load(data(), snap))
    },
    metrics() {
      const s = overlayStats(game)
      const st = core().state
      return {
        ...s,
        money: st.economy.balance,
        lifetimeEarned: st.economy.lifetimeEarned,
        level: st.level.level,
        lives: st.economy.lives,
        deliveries: st.stats.deliveries,
        malware: {
          spawned: st.stats.malwareSpawned,
          caught: st.stats.malwareCaught,
          missed: st.stats.malwareMissed,
        },
        minutes: st.stats.minutes,
        playtest: playtestCounters(recorder()?.snapshot() ?? null),
      }
    },
    dispatch(cmd: Command) {
      return core().dispatch(cmd)
    },
    replay() {
      const live = core()
      const replica = replay(
        data(),
        live.state.seed,
        live.commandLog,
        live.state.tick,
      )
      const hash = stateHash(replica.state)
      const liveHash = stateHash(live.state)
      return {
        hash,
        liveHash,
        matches: hash === liveHash,
        ticks: live.state.tick,
        commands: live.commandLog.length,
      }
    },
    overlay(on?: boolean) {
      const next = on ?? game.registry.get(REG_OVERLAY) === false
      game.registry.set(REG_OVERLAY, next)
      return next
    },
    speed(s) {
      stepper.speed = s
    },
    playtest() {
      return recorder()?.snapshot() ?? null
    },
    downloadPlaytest() {
      const pt = recorder()?.snapshot() ?? null
      return pt ? downloadJson(PLAYTEST_FILE, pt) : false
    },
    debugLotCorners(on = true) {
      const city = game.scene.getScene('City') as unknown as {
        setLotCorners?(on: boolean): boolean
      } | null
      return city?.setLotCorners?.(on) ?? false
    },
    quests() {
      return viewSim().quests()
    },
    events() {
      return viewSim().events()
    },
    answerCard,
  }
  window.__pm = pm

  // ready: Core READY (already past when Boot creates this) + the world
  // scene's CREATE — or, for a City created under the Title's attract tour,
  // its pm:attractEnd (the player's game is in).
  const key = worldSceneKey(p)
  const armWorld = (): void => {
    const scene = game.scene.getScene(key)
    if (!scene) return
    const done = (): void => {
      pm.ready = true
      scene.events.off(Phaser.Scenes.Events.CREATE, onCreate)
      game.events.off(EV_ATTRACT_END, done)
    }
    const onCreate = (): void => {
      if ((scene as unknown as { attract?: boolean }).attract !== true) done()
    }
    scene.events.on(Phaser.Scenes.Events.CREATE, onCreate)
    game.events.on(EV_ATTRACT_END, done)
  }
  if (game.isRunning) armWorld()
  else game.events.once(Phaser.Core.Events.READY, armWorld)
  return pm
}
