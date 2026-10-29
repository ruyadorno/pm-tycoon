// Navigation (plan.md §6.7, phaser4-notes.md §5). Boot -> Preload -> Title ->
// City use start(); City <-> Warehouse are siblings switched with
// sleep()/run() (never start/switch: those restart or shut down the caller).
// This is the M0 version: the plain switch, no transition. M2 adds the
// warehouse-view.md §5.3 pan + zoom-2 snap + 120 ms fade on top of goto().
import Phaser from 'phaser'

export type WorldView = 'city' | 'warehouse'

export interface GotoPayload {
  view: WorldView
  highlight?: string
}

export const EV_GOTO = 'pm:goto'
export const EV_VIEW = 'pm:view'

const KEY: Record<WorldView, 'City' | 'Warehouse'> = {
  city: 'City',
  warehouse: 'Warehouse',
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

/** Listen for pm:goto on the game bus (installed once, by Boot). */
export function installNav(game: Phaser.Game): () => void {
  const onGoto = (p: GotoPayload): void => {
    const to = KEY[p.view]
    const from = to === 'City' ? 'Warehouse' : 'City'
    const sm = game.scene
    if (sm.isActive(to) && !sm.isSleeping(to)) return
    if (sm.isActive(from) || sm.isPaused(from)) sm.sleep(from)
    sm.run(to, p.highlight ? { highlight: p.highlight } : undefined)
    if (sm.getScene('HUD') && sm.isActive('HUD')) sm.bringToTop('HUD')
    if (sm.isActive('Garage')) sm.bringToTop('Garage')
  }
  game.events.on(EV_GOTO, onGoto)
  return () => game.events.off(EV_GOTO, onGoto)
}
