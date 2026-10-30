// Overseas hub wording for the HUD side (spec-core §5.6, spec-build2 §4.1;
// design-m8-m9 §6.3): the district panel's hub rows, the building tooltip's
// hub line (pier / terminal / port office), the lost-life card's clearance
// suffix and the dock-bought toast. Every number comes from the ViewSim
// (`vs.hubs()` / `vs.hub(id)`: districts.json clearanceS / valueMult / sizes,
// the parcels clearing) — nothing here is a balance number. Pure: no Phaser,
// so tests/ui/hub-text.test.ts and the cards' tests run it under Node.
import type { GameData } from '../data/types.ts'
import type { BuildingId, DistrictId, Size } from '../sim/types.ts'
import { TICKS_PER_S } from '../sim/types.ts'
import type { HubClearing, HubView } from '../sim/view-api.ts'
import { formatClock } from './text.ts'

/** `×1.5`, `×2` (a districts.json multiplier, at most two decimals). */
export function multText(mult: number): string {
  const v = Number.isFinite(mult) ? mult : 1
  return `×${Math.round(v * 100) / 100}`
}

/** District panel row 2 of a hub: `Overseas hub · pays ×1.5`. */
export function hubPayLine(valueMult: number): string {
  return `Overseas hub · pays ${multText(valueMult)}`
}

/**
 * Seconds until the soonest clearance in `clearing` (clearTick asc, as the
 * ViewSim lists them), optionally only the parcels handed off at
 * `buildingId`; null when none is clearing. Never negative.
 */
export function nextClearS(
  clearing: readonly HubClearing[],
  tick: number,
  buildingId?: BuildingId,
): number | null {
  let soonest: number | null = null
  for (const c of clearing) {
    if (buildingId !== undefined && c.buildingId !== buildingId) continue
    if (soonest === null || c.clearTick < soonest) soonest = c.clearTick
  }
  return soonest === null ? null : Math.max(0, (soonest - tick) / TICKS_PER_S)
}

/** `3 clearing · next 0:32` (`1 clearing · next 0:05`), or null when none. */
export function clearingText(n: number, nextS: number | null): string | null {
  if (n <= 0) return null
  return nextS === null
    ? `${n} clearing`
    : `${n} clearing · next ${formatClock(nextS)}`
}

/**
 * District panel clearance row: `Clearance 45 s · 3 clearing · next 0:32`,
 * or `Clearance 45 s · nothing clearing`.
 */
export function hubClearanceLine(
  hub: Pick<HubView, 'clearanceS' | 'clearing'>,
  tick: number,
): string {
  const head = `Clearance ${hub.clearanceS} s`
  const c = clearingText(hub.clearing.length, nextClearS(hub.clearing, tick))
  return `${head} · ${c ?? 'nothing clearing'}`
}

/** The sizes a hub takes, smallest first: `Sizes: S M L XL` (Airport `Sizes: S M`). */
export function hubSizesLine(sizes: readonly Size[]): string {
  const order: readonly Size[] = ['S', 'M', 'L', 'XL']
  return `Sizes: ${order.filter((s) => sizes.includes(s)).join(' ')}`
}

/** The hub rows of the district panel (design-m8-m9 §6.3), top to bottom. */
export interface HubPanelRows {
  pay: string
  clearance: string
  sizes: string
}

export function hubPanelRows(
  hub: Pick<HubView, 'valueMult' | 'clearanceS' | 'clearing' | 'sizes'>,
  tick: number,
): HubPanelRows {
  return {
    pay: hubPayLine(hub.valueMult),
    clearance: hubClearanceLine(hub, tick),
    sizes: hubSizesLine(hub.sizes),
  }
}

/**
 * The building tooltip's hub part: `tag` joins the name row when it fits
 * (`Prefetch Pier 2 · overseas ×1.5`; null for the port office), `line`
 * replaces the waiting row (hubs never send parcels).
 */
export interface HubTip {
  tag: string | null
  line: string
}

/** What the tooltip needs of a buildings.json row. */
export interface HubTipBuilding {
  id: BuildingId
  district: DistrictId
  recv: number
}

/** The port office's label on its tooltip line (`Port office · …`). */
export const OFFICE_LABEL = 'Port office'

/**
 * The tooltip's hub part for `b`, or null when `b` is not in a map.hubs
 * district. A pier / terminal (recv > 0) counts the parcels handed off there
 * (`2 clearing · next 0:12`, or `Clears in 45 s` when none); the office
 * counts the whole hub (`Port office · 3 clearing · next 0:32` / `Port
 * office · nothing clearing`). An office that also receives (the Airport
 * terminal) shows the receiving tag with the hub-wide count.
 */
export function hubTip(
  hubs: readonly HubView[],
  b: HubTipBuilding,
  tick: number,
): HubTip | null {
  const hub = hubs.find((h) => h.id === b.district)
  if (!hub) return null
  const office = hub.office === b.id
  const receives = b.recv > 0
  const tag = receives ? `overseas ${multText(hub.valueMult)}` : null
  const mine = office
    ? hub.clearing
    : hub.clearing.filter((c) => c.buildingId === b.id)
  const count = clearingText(
    mine.length,
    nextClearS(hub.clearing, tick, office ? undefined : b.id),
  )
  if (office && !receives)
    return { tag, line: `${OFFICE_LABEL} · ${count ?? 'nothing clearing'}` }
  return { tag, line: count ?? `Clears in ${hub.clearanceS} s` }
}

/**
 * The tooltip's rows for a hub building: the tag joins the name
 * (`Prefetch Pier 2 · overseas ×1.5`) when `fits` says the joined row fits
 * the tooltip, else it leads the second row (`overseas ×2 · 2 clearing ·
 * next 0:12`), else (a long name and a long count) it gets a row of its own
 * under the clearance line (`extra`).
 */
export function hubTipRows(
  name: string,
  tip: HubTip,
  fits: (row: string) => boolean,
): { name: string; line: string; extra: string | null } {
  if (!tip.tag) return { name, line: tip.line, extra: null }
  const joined = `${name} · ${tip.tag}`
  if (fits(joined)) return { name: joined, line: tip.line, extra: null }
  const led = `${tip.tag} · ${tip.line}`
  if (fits(led)) return { name, line: led, extra: null }
  return { name, line: tip.line, extra: tip.tag }
}

/** What the vessel helpers read of the data: map.hubs. */
export type HubData = { map: Pick<GameData['map'], 'hubs'> }

/**
 * True when the hub's vessel is a plane: its map.hubs vessel frame names a
 * plane (`ap_plane`); before a hub has its map.hubs row (the Airport until
 * M9) its id decides.
 */
export function isPlaneHub(data: HubData, hub: DistrictId | null): boolean {
  const row = (data.map.hubs ?? []).find((h) => h.district === hub)
  return row ? /plane/.test(row.vessel.frame) : hub === 'airport'
}

/**
 * The lost-life card's clearance suffix (B2 §4.1 "the ship has sailed";
 * design R11): `the plane has left` for a plane hub, else `the ship has
 * sailed`.
 */
export function sailedText(data: HubData, hub: DistrictId | null): string {
  return isPlaneHub(data, hub) ? 'the plane has left' : 'the ship has sailed'
}

/** The hub's 16-px icon (M8 art): `ic_plane` for a plane hub, else `ic_ship`. */
export function hubIcon(
  data: HubData,
  hub: DistrictId | null,
): 'ic_ship' | 'ic_plane' {
  return isPlaneHub(data, hub) ? 'ic_plane' : 'ic_ship'
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'] as const

/**
 * `dock:bought` toast (design-m8-m9 §6.3): `Loading dock 2 open — two
 * vehicles unload at once` (`docksOwned` = lane.docks.length after the buy:
 * dock 3 bought before dock 2 still says two).
 */
export function dockBoughtToast(index: number, docksOwned: number): string {
  const n = Math.max(1, Math.floor(docksOwned))
  const word = COUNT_WORDS[n] ?? String(n)
  return `Loading dock ${index} open — ${word} vehicles unload at once`
}
