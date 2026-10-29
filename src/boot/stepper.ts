// The sim stepper (plan.md §6.5, phaser4-notes.md §5; spec §2): one listener
// on Phaser.Core.Events.STEP feeds a 100 ms accumulator —
//   acc = min(acc + min(delta, 500) × speed, 1000); while (acc >= 100) tick()
// — so at most 10 ticks run per frame at every speed and excess time is
// dropped (no spiral of death). `paused` (modal cards) skips the frame
// entirely; `speed` 0 holds the accumulator. registry 'alpha' = acc / 100 is
// the render interpolation factor scenes read in update(). advance(ms) is the
// uncapped, speed-independent sim-only entry (?fastForward=, __pm.advance):
// floor(ms / 100) ticks, no render. game.pause() is never used as a pause.
// With ?policy=1 the policy's step() runs before every tick on both paths.
import Phaser from 'phaser'

export const TICK_MS = 100
export const MAX_TICKS_PER_FRAME = 10
export const MAX_FRAME_DELTA_MS = 500
export type Speed = 0 | 1 | 2 | 4
export const SPEEDS: readonly Speed[] = [0, 1, 2, 4]

/** What the stepper drives: the Sim (only tick() is needed). */
export interface Tickable {
  tick(): void
}

/** The ?policy=1 scripted player: step() runs once before every tick(). */
export interface StepPolicy {
  step(): void
  dispose?(): void
}

export interface Stepper {
  /** The sim being stepped; swapped by setSim() (simBinding.ts) on load / new game. */
  sim: Tickable
  /** ?policy=1: called before every tick (src/sim/policy.ts, M1); null otherwise. */
  policy: StepPolicy | null
  speed: Speed
  /** Modal pause (lostLife, gameOver, paused, rotate, summary cards). */
  paused: boolean
  /** acc / TICK_MS in [0, 1): the render interpolation factor. */
  readonly alpha: number
  /** Ticks run since install (frames + advance). */
  readonly ticks: number
  /** Mean wall ms per tick over the recent window (debug overlay). */
  readonly simMsPerTick: number
  /** The STEP path: returns the number of ticks run. */
  frame(delta: number): number
  /** Sim only, uncapped, speed-independent: floor(ms / 100) ticks. */
  advance(ms: number): number
  /** Drop the accumulated remainder (after a load or a scene swap). */
  resetAccumulator(): void
  destroy(): void
}

export const REG_ALPHA = 'alpha'
export const REG_STEPPER = 'stepper'

const clock = (): number =>
  typeof performance === 'undefined' ? 0 : performance.now()

export function installStepper(game: Phaser.Game, sim: Tickable): Stepper {
  let acc = 0
  let ticks = 0
  let msPerTick = 0

  const runTicks = (n: number): void => {
    if (n <= 0) return
    const t0 = clock()
    for (let i = 0; i < n; i++) {
      stepper.policy?.step()
      stepper.sim.tick()
    }
    ticks += n
    const per = (clock() - t0) / n
    msPerTick = msPerTick === 0 ? per : msPerTick * 0.9 + per * 0.1
  }

  const stepper: Stepper = {
    sim,
    policy: null,
    speed: 1,
    paused: false,
    get alpha() {
      return acc / TICK_MS
    },
    get ticks() {
      return ticks
    },
    get simMsPerTick() {
      return msPerTick
    },
    frame(delta: number): number {
      const d = Math.max(0, Math.min(delta, MAX_FRAME_DELTA_MS))
      acc = Math.min(acc + d * this.speed, MAX_TICKS_PER_FRAME * TICK_MS)
      let n = 0
      while (acc >= TICK_MS) {
        acc -= TICK_MS
        n++
      }
      runTicks(n)
      game.registry.set(REG_ALPHA, acc / TICK_MS)
      return n
    },
    advance(ms: number): number {
      const n = Math.max(0, Math.floor(ms / TICK_MS))
      runTicks(n)
      game.registry.set(REG_ALPHA, acc / TICK_MS)
      return n
    },
    resetAccumulator(): void {
      acc = 0
      game.registry.set(REG_ALPHA, 0)
    },
    destroy(): void {
      game.events.off(Phaser.Core.Events.STEP, onStep)
    },
  }

  // Once per game step, before the scenes update (src:core/Game.js step()).
  const onStep = (_time: number, delta: number): void => {
    if (!stepper.paused) stepper.frame(delta)
  }
  game.events.on(Phaser.Core.Events.STEP, onStep)
  game.registry.set(REG_STEPPER, stepper)
  game.registry.set(REG_ALPHA, 0)
  return stepper
}
