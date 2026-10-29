// Sim <-> scene binding (plan.md §6.5, phaser4-notes.md §5). Scenes get the
// singletons from the game registry (REG keys below); world scenes subscribe
// to sim events with bindSim(), which
//   - registers every handler with sim.events.on(name, fn, scene) right away
//     (call it from create) and again on WAKE, then calls onSync (events
//     emitted while asleep are not replayed: rebuild from state);
//   - removes them on SLEEP and SHUTDOWN, and removes its own scene/game
//     listeners on SHUTDOWN (scene.events listeners survive shutdown);
//   - follows a Sim swap (setSim: __pm.load, New game, Continue): handlers move
//     from the old emitter to the new one and onSync runs.
// Handlers only mark things dirty or spawn effects; they never dispatch.
import Phaser from 'phaser'
import type { GameData } from '../data/index.ts'
import { debugEnabled } from '../debug/params.ts'
import type { SimEventName, SimEvents } from '../sim/events.ts'
import type { Sim } from '../sim/sim.ts'
import { createViewSim, type ViewSim } from '../sim/view-api.ts'
import type { StepPolicy, Stepper } from './stepper.ts'

/** Game registry keys (one place; scenes never invent their own). */
export const REG = {
  /** The Sim instance (raw; scenes use viewSim). */
  sim: 'sim',
  /** createViewSim(sim): the only object scenes touch (plan.md §5). */
  viewSim: 'viewSim',
  /** The Stepper (stepper.ts). */
  stepper: 'stepper',
  /** Render interpolation factor in [0, 1) (stepper.ts). */
  alpha: 'alpha',
  /** Validated GameData. */
  data: 'data',
  /** Parsed URL params (src/debug/params.ts). */
  params: 'params',
  /** HUD / Title build stamp (__pm.stamp overrides it). */
  buildStamp: 'buildStamp',
  /** Safe-area insets in logical px (src/main.ts, from the #safe probe). */
  safeTop: 'safeTop',
  safeBottom: 'safeBottom',
  /** The one shared AudioContext (null with ?audio=0). */
  audioContext: 'audioContext',
  /** (sim) => StepPolicy when ?policy=1 and src/sim/policy.ts exists. */
  policyFactory: 'policyFactory',
} as const

/** Game event emitted after setSim() swaps the Sim: payload {sim, viewSim}. */
export const SIM_REPLACED = 'pm:simReplaced'

export type SimHandlers = {
  [K in SimEventName]?: SimEvents[K]
}

export function getSim(scene: Phaser.Scene): Sim {
  return scene.registry.get(REG.sim) as Sim
}

export function getViewSim(scene: Phaser.Scene): ViewSim {
  return scene.registry.get(REG.viewSim) as ViewSim
}

export function getData(scene: Phaser.Scene): GameData {
  return scene.registry.get(REG.data) as GameData
}

export function getStepper(scene: Phaser.Scene): Stepper {
  return scene.registry.get(REG.stepper) as Stepper
}

/** Render interpolation factor for this frame (0 before the first step). */
export function getAlpha(scene: Phaser.Scene): number {
  return (scene.registry.get(REG.alpha) as number | undefined) ?? 0
}

/**
 * Install `sim` as the game's Sim: registry 'sim', the stepper's target
 * (accumulator reset, policy re-created for the new sim), then SIM_REPLACED
 * so bound scenes move their handlers. The ViewSim is created once over a
 * registry getter, so the facade object survives swaps. Used by Boot (first
 * sim), __pm.load, New game and Continue.
 */
export function setSim(game: Phaser.Game, sim: Sim): ViewSim {
  const prev = game.registry.get(REG.sim) as Sim | undefined
  game.registry.set(REG.sim, sim)
  let viewSim = game.registry.get(REG.viewSim) as ViewSim | undefined
  if (!viewSim) {
    viewSim = createViewSim(() => game.registry.get(REG.sim) as Sim, {
      debug: debugEnabled(),
    })
    game.registry.set(REG.viewSim, viewSim)
  }
  const stepper = game.registry.get(REG.stepper) as Stepper | undefined
  if (stepper) {
    stepper.sim = sim
    stepper.resetAccumulator()
    const factory = game.registry.get(REG.policyFactory) as
      | ((s: Sim) => StepPolicy)
      | undefined
    if (factory && prev !== sim) {
      stepper.policy?.dispose?.()
      stepper.policy = factory(sim)
    }
  }
  if (prev && prev !== sim) game.events.emit(SIM_REPLACED, { sim, viewSim })
  return viewSim
}

export interface SimBinding {
  /** True while the handlers are attached (scene awake). */
  readonly bound: boolean
  /** Detach everything now (also happens on SHUTDOWN). */
  unbind(): void
}

type AnyHandler = (payload: never) => void

/**
 * Subscribe `handlers` (bound to `scene` as context) to the current sim's
 * events for as long as the scene is awake. Call from create().
 */
export function bindSim(
  scene: Phaser.Scene,
  handlers: SimHandlers,
  onSync?: () => void,
): SimBinding {
  const entries = Object.entries(handlers) as [SimEventName, AnyHandler][]
  let emitter: Sim['events'] | null = null
  let alive = true

  const attach = (): void => {
    if (emitter || !alive) return
    const sim = getSim(scene)
    if (!sim) return
    emitter = sim.events
    for (const [name, fn] of entries)
      (emitter.on as (n: string, f: AnyHandler, c: unknown) => unknown)(
        name,
        fn,
        scene,
      )
  }
  const detach = (): void => {
    if (!emitter) return
    for (const [name, fn] of entries)
      (emitter.off as (n: string, f: AnyHandler, c: unknown) => unknown)(
        name,
        fn,
        scene,
      )
    emitter = null
  }
  const onWake = (): void => {
    attach()
    onSync?.()
  }
  const onSleep = (): void => detach()
  const onReplaced = (): void => {
    if (!emitter) return // asleep: WAKE will attach to the new sim
    detach()
    attach()
    onSync?.()
  }
  const teardown = (): void => {
    detach()
    alive = false
    scene.events.off(Phaser.Scenes.Events.WAKE, onWake)
    scene.events.off(Phaser.Scenes.Events.SLEEP, onSleep)
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, teardown)
    scene.game.events.off(SIM_REPLACED, onReplaced)
  }

  scene.events.on(Phaser.Scenes.Events.WAKE, onWake)
  scene.events.on(Phaser.Scenes.Events.SLEEP, onSleep)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown)
  scene.game.events.on(SIM_REPLACED, onReplaced)
  attach()

  return {
    get bound() {
      return emitter !== null
    },
    unbind: teardown,
  }
}
