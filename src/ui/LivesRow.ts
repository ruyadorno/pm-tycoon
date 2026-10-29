// Lives row (city-view.md §4.1, §3.3, §9.3; spec §10): five 16x16 slots with
// 2-px gaps, `ic_life_on` for each life and `ic_life_off` for the rest (start
// 3, cap 5, so slots 4–5 are empty outlines until the build-2 magic parcels).
// Shared by the HUD top bar and the lost-life card.
//
// loseLife(n) plays the §3.3 step-3 beat on the rightmost lit slot: its fuse
// lights (`ic_life_fuse_0/1` alternating, 400 ms), then the slot empties under
// an `fx_puff` (4 frames) — FUSE_STEPS below is the frame plan, stepped by a
// scene-clock timer so the frozen test clock drives it too. Phaser is a
// type-only import (the plan is unit-tested under Node).
import type Phaser from 'phaser'
import type { FrameName } from '../render/frames.ts'
import { UI_ATLAS } from '../render/atlases.ts'

export const LIFE_SLOTS = 5
export const LIFE_SLOT_PX = 16
export const LIFE_GAP = 2
/** One step of the fuse/puff animation. */
export const FUSE_STEP_MS = 100

/** Frame per slot, left to right. */
export function lifeFrames(lives: number, slots = LIFE_SLOTS): FrameName[] {
  const n = Math.max(0, Math.min(slots, Math.floor(lives)))
  const out: FrameName[] = []
  for (let i = 0; i < slots; i++) out.push(i < n ? 'ic_life_on' : 'ic_life_off')
  return out
}

/** Row width in px for `slots` slots. */
export function livesRowWidth(slots = LIFE_SLOTS): number {
  return slots * LIFE_SLOT_PX + (slots - 1) * LIFE_GAP
}

export interface FuseStep {
  /** The fusing slot's frame during this step. */
  slot: FrameName
  /** The puff overlay frame, or null (hidden). */
  puff: FrameName | null
}

/**
 * §3.3 step 3, one entry per FUSE_STEP_MS: the fuse burns 400 ms (2 frames
 * alternating), then the slot is empty under the 4-frame puff.
 */
export const FUSE_STEPS: readonly FuseStep[] = [
  { slot: 'ic_life_fuse_0', puff: null },
  { slot: 'ic_life_fuse_1', puff: null },
  { slot: 'ic_life_fuse_0', puff: null },
  { slot: 'ic_life_fuse_1', puff: null },
  { slot: 'ic_life_off', puff: 'fx_puff_f0' },
  { slot: 'ic_life_off', puff: 'fx_puff_f1' },
  { slot: 'ic_life_off', puff: 'fx_puff_f2' },
  { slot: 'ic_life_off', puff: 'fx_puff_f3' },
]

/**
 * The slot that fuses when the count drops to `lives` (the rightmost slot
 * that was lit), or null when nothing visible changes.
 */
export function fusingSlot(
  lives: number,
  shown: number,
  slots = LIFE_SLOTS,
): number | null {
  const n = Math.floor(lives)
  if (!(n < shown) || n < 0 || n >= slots) return null
  return n
}

export class LivesRow {
  readonly root: Phaser.GameObjects.Container
  private readonly scene: Phaser.Scene
  private slots: Phaser.GameObjects.Image[] = []
  private puff: Phaser.GameObjects.Image
  private lives = -1
  private anim: Phaser.Time.TimerEvent | null = null

  constructor(scene: Phaser.Scene, x: number, y: number, slots = LIFE_SLOTS) {
    this.scene = scene
    for (let i = 0; i < slots; i++) {
      this.slots.push(
        scene.add
          .image(i * (LIFE_SLOT_PX + LIFE_GAP), 0, UI_ATLAS, 'ic_life_off')
          .setOrigin(0, 0),
      )
    }
    this.puff = scene.add
      .image(0, 0, UI_ATLAS, 'fx_puff_f0')
      .setOrigin(0, 0)
      .setVisible(false)
    this.root = scene.add.container(Math.round(x), Math.round(y), [
      ...this.slots,
      this.puff,
    ])
  }

  get width(): number {
    return livesRowWidth(this.slots.length)
  }

  /** Lives currently drawn (-1 before the first set). */
  get shown(): number {
    return this.lives
  }

  /** Show `lives` filled slots at once (stops a running fuse; no-op when unchanged). */
  set(lives: number): this {
    if (lives === this.lives && !this.anim) return this
    this.stopAnim()
    this.lives = lives
    const frames = lifeFrames(lives, this.slots.length)
    this.slots.forEach((img, i) => img.setFrame(frames[i]!))
    return this
  }

  /**
   * §3.3: the rightmost lit slot lights its fuse, puffs and empties, ending
   * at `lives` filled slots. Falls back to set() when no lit slot is lost.
   */
  loseLife(lives: number): this {
    const from = this.lives
    this.set(lives)
    const i = fusingSlot(lives, from, this.slots.length)
    const img = i === null ? null : this.slots[i]
    if (i === null || !img) return this
    this.puff.setPosition(img.x, img.y)
    let step = 0
    const apply = (): void => {
      const s = FUSE_STEPS[step]
      if (!s) {
        this.stopAnim()
        return
      }
      img.setFrame(s.slot)
      if (s.puff) this.puff.setFrame(s.puff).setVisible(true)
      else this.puff.setVisible(false)
      step++
    }
    apply()
    this.anim = this.scene.time.addEvent({
      delay: FUSE_STEP_MS,
      repeat: FUSE_STEPS.length - 1,
      callback: apply,
    })
    return this
  }

  setPosition(x: number, y: number): this {
    this.root.setPosition(Math.round(x), Math.round(y))
    return this
  }

  destroy(): void {
    this.stopAnim()
    this.root.destroy()
  }

  private stopAnim(): void {
    this.anim?.remove(false)
    this.anim = null
    this.puff.setVisible(false)
    if (this.lives >= 0) {
      const frames = lifeFrames(this.lives, this.slots.length)
      this.slots.forEach((img, i) => img.setFrame(frames[i]!))
    }
  }
}
