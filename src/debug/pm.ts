// window.__pm — the debug / test API (plan.md §5, §6.8; phaser4-notes.md
// §10). Installed by Boot when import.meta.env.DEV || ?debug=1. The clock
// helpers drive TimeStep (not Game) so input, scene clocks, tweens and timers
// all see one synthetic clock:
//   freeze()  = loop.sleep(); loop.smoothStep = false (exact deltas);
//               tweens follow the stepped clock too (installTweenClock)
//   step(ms)  = loop.step(loop.now + ms): one update + render
//   settle(n) = n x step(16)
//   thaw()    = loop.smoothStep = true; loop.wake()
//   advance(ms) = stepper.advance(ms): sim only, no render, uncapped
// `sim` is the ViewSim facade (what scenes use: rush, debug.*), `core` the
// raw Sim (state, commandLog, dispatch). Both follow setSim() swaps.
// `ready` flips after Core READY + the CREATE of the world scene ?view=
// selects (City by default, Warehouse, Gallery).
import Phaser from 'phaser'
import type { Stepper } from '../boot/stepper.ts'
import { REG, setSim } from '../boot/simBinding.ts'
import { EV_GOTO, type WorldView } from '../boot/nav.ts'
import type { GameData } from '../data/index.ts'
import type { Command, CommandResult } from '../sim/commands.ts'
import type { SimEventName, SimEventPayloads } from '../sim/events.ts'
import { replay, Sim, stateHash, type SimSnapshot } from '../sim/sim.ts'
import type { ViewSim } from '../sim/view-api.ts'
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
  readonly seed: number
  readonly stepper: Stepper
  readonly data: GameData
  readonly params: Params
  ready: boolean
  freeze(): void
  thaw(): void
  step(ms?: number): void
  advance(ms: number): number
  settle(frames?: number): void
  stamp(text: string): void
  goto(view: WorldView): void
  waitEvent<K extends SimEventName>(
    name: K,
    capMs?: number,
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
  /** Added by later modules (src/metrics/playtest.ts, src/audio/*). */
  playtest?: () => unknown
  downloadPlaytest?: () => void
  audio?: unknown
}

declare global {
  interface Window {
    __pm?: PmApi
  }
}

export const WAIT_STEP_MS = 100
export const WAIT_CAP_MS = 60_000

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

  const pm: PmApi = {
    game,
    get sim() {
      return game.registry.get(REG.viewSim) as ViewSim
    },
    get core() {
      return core()
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
    advance(ms: number) {
      return stepper.advance(ms)
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
    waitEvent<K extends SimEventName>(name: K, capMs = WAIT_CAP_MS) {
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
          stepper.advance(WAIT_STEP_MS)
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
  }
  window.__pm = pm

  // ready: Core READY (already past when Boot creates this) + the world
  // scene's CREATE.
  const key = worldSceneKey(p)
  const armWorld = (): void => {
    const scene = game.scene.getScene(key)
    if (!scene) return
    scene.events.once(Phaser.Scenes.Events.CREATE, () => {
      pm.ready = true
    })
  }
  if (game.isRunning) armWorld()
  else game.events.once(Phaser.Core.Events.READY, armWorld)
  return pm
}
