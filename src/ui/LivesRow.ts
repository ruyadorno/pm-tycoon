// Lives row (city-view.md §4.1, §9.3; spec §10): five 16x16 slots with 2-px
// gaps, `ic_life_on` for each life and `ic_life_off` for the rest (start 3,
// cap 5, so slots 4–5 are empty outlines until the build-2 magic parcels).
// Shared by the HUD top bar and the M2 lost-life card. The lit-fuse / puff
// animation of §3.3 is M2 (it will use ic_life_fuse_0/1 on the rightmost
// filled slot before set() drops it). Phaser is a type-only import.
import type Phaser from 'phaser'
import type { FrameName } from '../render/frames.ts'
import { UI_ATLAS } from '../render/atlases.ts'

export const LIFE_SLOTS = 5
export const LIFE_SLOT_PX = 16
export const LIFE_GAP = 2

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

export class LivesRow {
  readonly root: Phaser.GameObjects.Container
  private slots: Phaser.GameObjects.Image[] = []
  private lives = -1

  constructor(scene: Phaser.Scene, x: number, y: number, slots = LIFE_SLOTS) {
    for (let i = 0; i < slots; i++) {
      this.slots.push(
        scene.add
          .image(i * (LIFE_SLOT_PX + LIFE_GAP), 0, UI_ATLAS, 'ic_life_off')
          .setOrigin(0, 0),
      )
    }
    this.root = scene.add.container(Math.round(x), Math.round(y), this.slots)
  }

  get width(): number {
    return livesRowWidth(this.slots.length)
  }

  /** Show `lives` filled slots (no-op when unchanged). */
  set(lives: number): this {
    if (lives === this.lives) return this
    this.lives = lives
    const frames = lifeFrames(lives, this.slots.length)
    this.slots.forEach((img, i) => img.setFrame(frames[i]!))
    return this
  }

  setPosition(x: number, y: number): this {
    this.root.setPosition(Math.round(x), Math.round(y))
    return this
  }

  destroy(): void {
    this.root.destroy()
  }
}
