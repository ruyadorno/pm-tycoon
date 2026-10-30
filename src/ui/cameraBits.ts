// Removing a card's own camera cleanly (final review, scenes #1). Every
// full-screen card and dialog (LostLifeCard, VictoryCard, SummaryCard,
// GameOverCard, Dialog, HireSheet, ZonePicker, the Sheet's list camera, the
// RotateCard) draws through a camera of its own that ignores every other
// object in the scene: Camera.ignore sets the camera's id bit in each
// object's `cameraFilter`. Phaser 4 hands a freed id to the next camera
// (CameraManager.getNextID: the lowest bit no live camera holds), so a bit
// left behind makes a later, unrelated camera skip that object — neither
// drawn nor hit-tested. The rotate card after one confirm dialog was the
// case found: its root still carried the dialog camera's bit, the rotate
// camera got the same id, and landscape showed the paused HUD instead.
// removeCamera clears the bit from every object in the scene (containers'
// children included) before it removes the camera.
//
// Phaser is a type-only import (Vitest loads this under Node).
import type Phaser from 'phaser'

type Camera = Phaser.Cameras.Scene2D.Camera

interface Filtered {
  cameraFilter?: number
  list?: unknown
}

/** Clear `bit` from `objs` and, recursively, from containers' children. */
export function clearCameraBit(objs: readonly unknown[], bit: number): void {
  if (bit === 0) return
  for (const o of objs) {
    if (typeof o !== 'object' || o === null) continue
    const f = o as Filtered
    if (typeof f.cameraFilter === 'number') f.cameraFilter &= ~bit
    if (Array.isArray(f.list)) clearCameraBit(f.list, bit)
  }
}

/**
 * Remove (and destroy) `cam` from `scene`, first clearing its id bit from
 * every object on the scene's display list so the id's next owner starts
 * clean. Safe during shutdown (a torn-down scene has no lists left).
 */
export function removeCamera(scene: Phaser.Scene, cam: Camera | null): void {
  if (!cam) return
  const list = scene.children?.list
  if (list) clearCameraBit(list, cam.id)
  scene.cameras?.remove(cam, true)
}
