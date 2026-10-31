// The sim stepper (plan.md §6.5, phaser4-notes.md §5; spec §2): one listener
// on Phaser.Core.Events.STEP feeds a 100 ms accumulator —
//   acc = min(acc + min(delta, 500) × speed, 1000); while (acc >= 100) tick()
// — so at most 10 ticks run per frame at every speed and excess time is
// dropped (no spiral of death). `paused` (modal cards) skips the frame
// entirely; `speed` 0 holds the accumulator. registry 'alpha' = acc / 100 is
// the render interpolation factor scenes read in update(). advance(ms) is the
// uncapped, speed-independent sim-only entry (?fastForward=, __pm.advance):
// floor(ms / 100) ticks, no render. game.pause() is never used as a pause.
// With ?policy=1 the policy's step() runs before every tick on both paths;
// the Title's attract sim (B2 §5) gets the competent policy the same way
// (setSim's `policy` option), at speed 1, whatever ?policy says.
// Build 3 (B3 §3.2, §6; review deck-2): while the sim is `held` (a card open,
// no policy) the stepper runs no tick — frame() leaves the accumulator and
// 'alpha' untouched (vehicles stand still instead of replaying their last
// 100 ms step at 10 Hz) and a frame or an advance stops at the tick that
// opened the card; `ticks` and `simMsPerTick` count only the ticks that ran.
import Phaser from 'phaser'

export const TICK_MS = 100
export const MAX_TICKS_PER_FRAME = 10
export const MAX_FRAME_DELTA_MS = 500
export type Speed = 0 | 1 | 2 | 4
export const SPEEDS: readonly Speed[] = [0, 1, 2, 4]

/** What the stepper drives: the Sim (tick(), and `held` when it can hold). */
export interface Tickable {
  tick(): void
  /** B3 §6: true while tick() would do nothing (Sim.held: a card open, no policy). */
  readonly held?: boolean
}

/** The ?policy=1 scripted player: step() runs once before every tick(). */
export interface StepPolicy {
  step(): void
  dispose?(): void
}

export interface Stepper {
  /** The sim being stepped; swapped by setSim() (simBinding.ts) on load / new game. */
  sim: Tickable
  /** ?policy=1 / the attract sim: called before every tick (src/sim/policy.ts); null otherwise. */
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

/**
 * True while no tick runs: a HUD hold, 0×, or (B3 §6) the sim held by a
 * pending card — Sim.held while a sheet, panel or paper keeps the card off
 * the screen and no hold is set yet (review sim-3). The audio director's
 * loops (hiss, stall alarm, grumble) and the City's grumble wait on it, as
 * the HUD's ❚❚ / PAUSED do (speedSegment(st.paused || vs.held)).
 */
export function simStopped(
  st: Pick<Stepper, 'paused' | 'speed' | 'sim'>,
): boolean {
  return st.paused || st.speed === 0 || st.sim.held === true
}

const clock = (): number =>
  typeof performance === 'undefined' ? 0 : performance.now()

export function installStepper(game: Phaser.Game, sim: Tickable): Stepper {
  let acc = 0
  let ticks = 0
  let msPerTick = 0

  /** Up to n ticks, stopping at a hold; returns the ticks that ran. */
  const runTicks = (n: number): number => {
    if (n <= 0) return 0
    const t0 = clock()
    let ran = 0
    for (let i = 0; i < n; i++) {
      stepper.policy?.step()
      if (stepper.sim.held === true) break
      stepper.sim.tick()
      ran++
    }
    if (ran === 0) return 0
    ticks += ran
    const per = (clock() - t0) / ran
    msPerTick = msPerTick === 0 ? per : msPerTick * 0.9 + per * 0.1
    return ran
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
      // Held: the frame is skipped whole (acc and alpha as they were).
      if (this.sim.held === true) return 0
      const d = Math.max(0, Math.min(delta, MAX_FRAME_DELTA_MS))
      acc = Math.min(acc + d * this.speed, MAX_TICKS_PER_FRAME * TICK_MS)
      let n = 0
      while (acc >= TICK_MS) {
        acc -= TICK_MS
        n++
      }
      const ran = runTicks(n)
      game.registry.set(REG_ALPHA, acc / TICK_MS)
      return ran
    },
    advance(ms: number): number {
      const ran = runTicks(Math.max(0, Math.floor(ms / TICK_MS)))
      game.registry.set(REG_ALPHA, acc / TICK_MS)
      return ran
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
