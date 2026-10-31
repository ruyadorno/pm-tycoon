// Modifier mutations (spec-build3 §3.6; M11 contract §2.8, D-35): the plain
// state operations behind the pure fold of src/sim/modifiers.ts — apply a
// row, end rows (an `end` effect, expiry), and the per-tick expiry (the deck
// step's first sub-step). After a change the derived numbers that are stored
// rather than folded at read time are re-synced: inspectorP → every desk's
// station p (people.ts resyncDesks), shelfCap → the shelf cap (levels.ts
// syncShelfCap). Everything else reads the fold live.

import type { ModifierKey } from '../../data/types.ts'
import type { Sim } from '../sim.ts'
import type { Modifier, Tick } from '../types.ts'
import { syncShelfCap } from './levels.ts'
import { resyncDesks } from './people.ts'

/** What an effect hands applyModifier (the id, applied tick and order come from the sim). */
export interface ModifierInput {
  key: ModifierKey
  /** 1 for an add-type row. */
  mult: number
  /** 0 for a mult-type row. */
  add: number
  scope: string | null
  /** null = permanent. */
  untilTick: Tick | null
  eventId: string
  /** The setting card's title (EffectsCard, ticker). */
  label: string
}

/** The stored numbers that depend on `keys` follow the fold again. */
function resync(sim: Sim, keys: readonly ModifierKey[]): void {
  if (keys.includes('inspectorP')) resyncDesks(sim)
  if (keys.includes('shelfCap')) syncShelfCap(sim)
}

/**
 * Push a row ('m<n>' from nextId.modifier), raise events.stats.modifiersPeak,
 * emit `modifier:applied`, then resync (inspectorP → resyncDesks; shelfCap →
 * syncShelfCap).
 */
export function applyModifier(sim: Sim, m: ModifierInput): Modifier {
  const s = sim.state
  const row: Modifier = {
    id: `m${s.nextId.modifier}`,
    key: m.key,
    mult: m.mult,
    add: m.add,
    scope: m.scope,
    untilTick: m.untilTick,
    eventId: m.eventId,
    label: m.label,
    appliedTick: s.tick,
  }
  s.nextId.modifier += 1
  s.modifiers.push(row)
  const st = s.events.stats
  st.modifiersPeak = Math.max(st.modifiersPeak, s.modifiers.length)
  sim.emit('modifier:applied', {
    id: row.id,
    key: row.key,
    untilTick: row.untilTick,
    eventId: row.eventId,
  })
  resync(sim, [row.key])
  return row
}

/**
 * Remove every row matching `pred` (state order): `modifier:expired` for
 * each, the ticker line puns.tickerEvent.modifierEnded {label} (kind
 * 'event') once per distinct label, then the resyncs. Returns the removed
 * rows.
 */
export function endModifiers(
  sim: Sim,
  pred: (m: Modifier) => boolean,
): Modifier[] {
  const s = sim.state
  if (s.modifiers.length === 0) return []
  const gone = s.modifiers.filter(pred)
  if (gone.length === 0) return []
  s.modifiers = s.modifiers.filter((m) => !pred(m))
  for (const m of gone) sim.emit('modifier:expired', { id: m.id, key: m.key })
  const labels: string[] = []
  for (const m of gone) if (!labels.includes(m.label)) labels.push(m.label)
  for (const label of labels) {
    sim.emit('ticker:news', {
      text: sim.data.puns.tickerEvent.modifierEnded.replaceAll(
        '{label}',
        label,
      ),
      kind: 'event',
    })
  }
  resync(
    sim,
    gone.map((m) => m.key),
  )
  return gone
}

/** Tick (the deck step's first sub-step): rows whose untilTick has come end now. */
export function modifiersStep(sim: Sim): void {
  const tick = sim.state.tick
  endModifiers(sim, (m) => m.untilTick !== null && m.untilTick <= tick)
}
