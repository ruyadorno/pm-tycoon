// Navigation (plan.md §6.7, phaser4-notes.md §5, warehouse-view.md §5.3).
// Boot -> Preload -> Title -> City use start(); City <-> Warehouse are
// siblings switched with sleep()/run() (never start/switch: those restart or
// shut down the caller).
//
// pm:goto {view, highlight?} (any scene) runs the leaving world scene's
// transition first, then sleeps it and runs the target:
//   - a scene exposing `transitionOut(to, done)` (WorldTransition) plays its
//     own exit and calls done() once — CityScene's is the §5.3 "zoom-in":
//     store the camera in registry 'cityCam', pan 200 ms to the warehouse,
//     snap to zoom 2 if at 1, fadeOut 120 ms to water1;
//   - any other awake world scene gets the generic exit: its main camera
//     fades out 120 ms to water1 (the camera FX is reset when it sleeps, so
//     it never wakes up blank).
// The target emits pm:view {name} on wake (each world scene's job) and fades
// itself in; City restores 'cityCam'. `instant: true` (or the frozen test
// clock) skips the exit. A goto while one is in flight is
// dropped; a transition that never completes switches anyway after
// TRANSITION_TIMEOUT_MS of game time.
//
// Build 2 (B2 §5): the Title runs above the City in attract mode (the Title
// launches City with {attract: true} and brings itself to the top); Continue
// / New game swap the sims under a fade, launch the HUD and stop the Title —
// the City is never restarted, it emits EV_ATTRACT_END instead (what
// __pm.ready waits for when the City was created in attract mode).
import Phaser from 'phaser'
import { THEME } from '../ui/theme.ts'

export type WorldView = 'city' | 'warehouse'

export interface GotoPayload {
  view: WorldView
  highlight?: string
  /** Skip the exit transition (tests, restores). */
  instant?: boolean
}

export const EV_GOTO = 'pm:goto'
export const EV_VIEW = 'pm:view'
/** Game event: the City left attract mode (the player's sim is installed). */
export const EV_ATTRACT_END = 'pm:attractEnd'
/**
 * Game event: the Garage is about to open (GarageSheet toggleGarage). The
 * Warehouse drops its open HireSheet so two applicant pickers never stack
 * (the Garage's own buy / Replace picker would open over it).
 */
export const EV_GARAGE_OPENING = 'pm:garageOpening'
/** Attract → game: each half of the 300-ms swap fade (out, then in; B2 §5). */
export const ATTRACT_FADE_MS = 150

/** CityScene start data (B2 §5). */
export interface CityStartData {
  /** The Title's attract city: no gestures, no HUD, the camera tour. */
  attract?: boolean
}

/** Registry key: the City camera {zoom, scrollX, scrollY} before its exit snap. */
export const REG_CITY_CAM = 'cityCam'

export interface StoredCam {
  zoom: number
  scrollX: number
  scrollY: number
}

/** A world scene that plays its own exit before nav sleeps it. */
export interface WorldTransition {
  transitionOut(to: WorldView, done: () => void): void
}

/** Exit fade (warehouse-view §5.3): 120 ms to the game background (water1). */
export const FADE_OUT_MS = 120
/** Entry fade of the waking scene. */
export const FADE_IN_MS = 150
/** City → warehouse pan to the warehouse sprite. */
export const PAN_TO_WAREHOUSE_MS = 200
const TRANSITION_TIMEOUT_MS = 2000

/** water1 as 0..255 channels for camera fades. */
export const FADE_RGB: readonly [number, number, number] = [
  (THEME.background >> 16) & 255,
  (THEME.background >> 8) & 255,
  THEME.background & 255,
]

const KEY: Record<WorldView, 'City' | 'Warehouse'> = {
  city: 'City',
  warehouse: 'Warehouse',
}

function hasTransition(s: unknown): s is WorldTransition {
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof (s as Partial<WorldTransition>).transitionOut === 'function'
  )
}

/**
 * Start a world scene from Boot/Preload/Title (`from` is shut down) with the
 * HUD launched in parallel above it (plan.md §6.7). Gallery runs alone.
 */
export function startWorld(
  from: Phaser.Scene,
  key: 'City' | 'Warehouse' | 'Gallery',
): void {
  const sp = from.scene
  if (key === 'Gallery') {
    sp.start('Gallery')
    return
  }
  sp.stop('Garage')
  sp.stop('HUD')
  // ?view=warehouse starts the Warehouse alone; goto('city') later run()s
  // (starts) the City, which then sleeps/wakes like any sibling.
  sp.start(key)
  sp.launch('HUD')
  sp.bringToTop('HUD')
}

/** Fade a scene's main camera to water1, then call done (generic exit). */
function fadeOutScene(scene: Phaser.Scene, done: () => void): void {
  const cam = scene.cameras.main
  scene.events.once(Phaser.Scenes.Events.SLEEP, () => cam.resetFX())
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, done)
  cam.fadeOut(FADE_OUT_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2])
}

/** Listen for pm:goto on the game bus (installed once, by Boot). */
export function installNav(game: Phaser.Game): () => void {
  let busySince: number | null = null
  let pending: (() => void) | null = null

  const onGoto = (p: GotoPayload): void => {
    const to = KEY[p.view]
    if (!to) return
    const from = to === 'City' ? 'Warehouse' : 'City'
    const sm = game.scene
    if (sm.isActive(to) && !sm.isSleeping(to)) return
    if (pending) return
    busySince = game.loop.now

    let switched = false
    const doSwitch = (): void => {
      if (switched) return
      switched = true
      pending = null
      busySince = null
      if (sm.isActive(from) || sm.isPaused(from)) sm.sleep(from)
      sm.run(to, p.highlight ? { highlight: p.highlight } : undefined)
      if (sm.getScene('HUD') && sm.isActive('HUD')) sm.bringToTop('HUD')
      if (sm.isActive('Garage')) sm.bringToTop('Garage')
    }

    const leaving = sm.getScene(from)
    // The frozen test clock (__pm.freeze: loop asleep, frames stepped by
    // hand) switches at once so shots never catch a half-faded camera.
    const instant = p.instant === true || !game.loop.running
    if (!leaving || !sm.isActive(from) || instant) {
      doSwitch()
      return
    }
    pending = doSwitch
    try {
      if (hasTransition(leaving)) leaving.transitionOut(p.view, doSwitch)
      else fadeOutScene(leaving, doSwitch)
    } catch (err) {
      console.error(err)
      doSwitch()
    }
  }
  // A transition that never reports back (scene stopped mid-exit) still
  // switches, on the game clock so the frozen test clock keeps control.
  const onStep = (): void => {
    if (
      pending &&
      busySince !== null &&
      game.loop.now - busySince > TRANSITION_TIMEOUT_MS
    )
      pending()
  }
  game.events.on(EV_GOTO, onGoto)
  game.events.on(Phaser.Core.Events.STEP, onStep)
  return () => {
    game.events.off(EV_GOTO, onGoto)
    game.events.off(Phaser.Core.Events.STEP, onStep)
  }
}
