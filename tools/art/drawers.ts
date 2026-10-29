// Drawer registry (contract: draw-api.ts).
//
// registerDrawer({ id: 'van' }, fn)            exact id      (wins)
// registerDrawer({ id: /^road_\d\d$/ }, fn)    id RegExp
// registerDrawer({ class: 'building2x2' }, fn) class match   (loses to ids)
// A match with both class and id requires both and ranks as an id match.
// Ties within a rank: the later registration wins. No match -> fallback.ts.
//
// Generator modules self-register on import. loadDrawers() imports them from
// the static list below — each art agent adds/owns ONE line (the stubs exist
// so the list never breaks). Imports are dynamic so the modules can import
// registerDrawer from this file without an ESM cycle.

import { fallbackDrawer } from './fallback.ts'
import type { Drawer } from './draw-api.ts'
import type { AssetClass, ManifestEntry } from './manifest.ts'

export interface DrawerMatch {
  class?: AssetClass
  id?: string | RegExp
}

interface Registered {
  match: DrawerMatch
  fn: Drawer
  order: number
}

const registry: Registered[] = []

export function registerDrawer(match: DrawerMatch, fn: Drawer): void {
  if (match.class === undefined && match.id === undefined) {
    throw new Error('registerDrawer: match needs a class or an id')
  }
  registry.push({ match, fn, order: registry.length })
}

/** 3 = exact id, 2 = id RegExp, 1 = class only, 0 = no match */
function rank(m: DrawerMatch, e: ManifestEntry): number {
  if (m.class !== undefined && m.class !== e.class) return 0
  if (m.id === undefined) return 1
  if (typeof m.id === 'string') return m.id === e.id ? 3 : 0
  m.id.lastIndex = 0
  return m.id.test(e.id) ? 2 : 0
}

/** The registered drawer for an entry, or null (caller falls back). */
export function findDrawer(e: ManifestEntry): Drawer | null {
  let best: Registered | null = null
  let bestRank = 0
  for (const r of registry) {
    const k = rank(r.match, e)
    if (
      k > 0 &&
      (k > bestRank || (k === bestRank && best && r.order > best.order))
    ) {
      best = r
      bestRank = k
    }
  }
  return best ? best.fn : null
}

/** The drawer for an entry; the generic placeholder when none matches. */
export function drawerFor(e: ManifestEntry): Drawer {
  return findDrawer(e) ?? fallbackDrawer
}

let loaded: Promise<void> | null = null

/** Import every generator module once (they call registerDrawer). */
export function loadDrawers(): Promise<void> {
  loaded ??= (async () => {
    await import('./tiles.ts') // §2.2 ground, roads, lot, kerbs
    await import('./buildings.ts') // §2.3-2.4 buildings, scenery, mood_*
    await import('./vehicles.ts') // §2.6 bike, van, truck
    await import('./exterior.ts') // §2.5 wh_ext, sign_days, props, docks
    await import('./warehouse.ts') // §2.7 interior tiles, fixtures, worker
    await import('./parcels.ts') // §2.8 parcels, parcel_mini_*
    await import('./icons.ts') // §2.8 ic_*, arrow, wh_dock_light
    await import('./ui.ts') // §2.8 ui_*, badge_new, sign_title
    await import('./fx.ts') // §2.8 fx_*, ring, rush_ring
  })()
  return loaded
}
