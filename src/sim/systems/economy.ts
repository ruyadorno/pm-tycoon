// Money flows of the city loop (spec §7.2-§7.3) and lives (§10): a local
// delivery pays round(base × f(t)) at the stop (lifetime earned, district
// `earned`, money:changed 'delivery'); malware delivered pays $0, costs the
// destination district malwareDelivered satisfaction and one life
// (SIM_FEATURES.lives): `life:lost` with the full card payload
// (detection.ts lostLifeReport), lastLostLife, daysSinceIncident = 0, and
// `game:over` when the last life goes; a sold vehicle refunds
// economy.sellRefund × its price ('refund', never lifetime earned).
// Purchases go through Sim.debit in the command handlers. The balance never
// goes negative (Sim.debit throws).

import { lostLifeReport, slotResultEntry } from '../detection.ts'
import { SIM_FEATURES } from '../features.ts'
import { districtDef } from '../map.ts'
import type { Sim } from '../sim.ts'
import type { EventLostLifeReport, Parcel, Strain, Vehicle } from '../types.ts'
import { laneNode, liveSlotIds, TICKS_PER_S } from '../types.ts'
import { ageS, isOnTime, paidValue } from '../value.ts'
import { debugParcel } from './holdbay.ts'
import { isActiveSlot } from './lane.ts'
import { addWanted, driverNumbers, driverOf } from './people.ts'
import { changeSatisfaction } from './satisfaction.ts'

/**
 * Deliver one parcel at its destination stop (§4.5 step 3, §7.3, §9.1):
 * parcel:delivered {paid, onTime, malware}, then the payout and the
 * satisfaction delta (on time: +onTime, +favouredBonus by the district's
 * favoured vehicle, + the driver's charisma deliveryBonus (M6, spec-build2
 * §2.5) — one positive delta inside positiveCapPerDay; late: −late; malware:
 * −malwareDelivered, paid 0, and a life). `v` is the delivering vehicle
 * (null for a debug delivery).
 */
export function deliverParcel(sim: Sim, v: Vehicle | null, p: Parcel): void {
  const s = sim.state
  const data = sim.data
  const sat = data.economy.satisfaction
  const onTime = isOnTime(data, ageS(p, s.tick))
  const paid = p.malware ? 0 : paidValue(data, p, s.tick)
  p.state = 'delivered'
  p.vehicleId = null
  p.reservedBy = null
  p.trace.push({ tick: s.tick, what: 'delivered', ref: p.dest })
  // M7: a delivered golden parcel is no longer alive (spawn.magicAlive is
  // the one count; magic.ts adds, this removes).
  if (p.magic) s.spawn.magicAlive = Math.max(0, s.spawn.magicAlive - 1)
  s.stats.deliveries += 1
  if (s.stats.firstDeliveryTick === null) s.stats.firstDeliveryTick = s.tick
  sim.emit('parcel:delivered', {
    id: p.id,
    paid,
    onTime,
    malware: p.malware,
  })
  const district = p.destRegion
  if (p.malware) {
    s.stats.malwareMissed += 1
    changeSatisfaction(sim, district, sat.malwareDelivered, 'other')
    loseLife(sim, p, false)
    return
  }
  if (onTime) s.stats.onTime += 1
  else s.stats.late += 1
  if (paid > 0) {
    sim.credit(paid, 'delivery', true)
    const d = s.districts[district]
    if (d) d.earned += paid
  }
  if (onTime) {
    const favoured =
      v !== null && districtDef(data, district).favoured.includes(v.type)
    const driver = v === null ? null : driverOf(sim, v)
    const charisma =
      v === null || driver === null
        ? 0
        : driverNumbers(data, driver.pips, driver.affinity, v.type)
            .deliveryBonus
    changeSatisfaction(
      sim,
      district,
      sat.onTime + (favoured ? sat.favouredBonus : 0) + charisma,
      'positive',
    )
  } else {
    changeSatisfaction(sim, district, sat.late, 'other')
  }
}

/**
 * §10: malware reached a consumer (a local delivery, or an overseas
 * clearance — hubs.ts, M8). One life (never below 0), the report, the incident
 * counter, `life:lost`, and `game:over` when the last life goes. Off while
 * SIM_FEATURES.lives is (M1 behaviour: $0 and the satisfaction hit only).
 */
export function loseLife(sim: Sim, p: Parcel, viaClearance: boolean): void {
  if (!SIM_FEATURES.lives) return
  const s = sim.state
  const eco = s.economy
  const wasOver = eco.gameOver
  eco.lives = Math.max(0, eco.lives - 1)
  eco.daysSinceIncident = 0
  s.stats.livesLost += 1
  addWanted(s, p.label)
  const report = lostLifeReport(sim, p, viaClearance)
  s.lastLostLife = report
  const card = structuredClone(report)
  sim.emit('life:lost', {
    parcelId: card.parcelId,
    label: card.label,
    strain: card.strain,
    destBuildingId: card.destBuildingId,
    path: card.path,
    laneRate: card.laneRate,
    counterMachineId: card.counterMachineId,
    counterOwned: card.counterOwned,
    counterRate: card.counterRate,
    clearedByPlayerAt: card.clearedByPlayerAt,
    missedBy: structuredClone(card.missedBy),
    inspectorRate: card.inspectorRate,
    sorterCall: structuredClone(card.sorterCall),
    report: card,
    cause: 'malware',
  })
  if (eco.lives === 0 && !wasOver) {
    eco.gameOver = true
    sim.emit('game:over', { cause: 'malware' })
  }
}

/** B3 §3.5: an event option took a life — no parcel, no wanted label; the ordinary game-over path. */
export function loseLifeEvent(
  sim: Sim,
  eventId: string,
  title: string,
  option: string,
): void {
  if (!SIM_FEATURES.lives) return
  const s = sim.state
  const eco = s.economy
  const wasOver = eco.gameOver
  eco.lives = Math.max(0, eco.lives - 1)
  eco.daysSinceIncident = 0
  s.stats.livesLost += 1
  s.events.stats.livesLost += 1
  const report: EventLostLifeReport = {
    kind: 'event',
    tick: s.tick,
    eventId,
    title,
    option,
    livesLeft: eco.lives,
  }
  s.lastLostLife = report
  sim.emit('life:lost', {
    cause: 'event',
    eventId,
    title,
    option,
    lives: eco.lives,
    report: structuredClone(report),
  })
  if (eco.lives === 0 && !wasOver) {
    eco.gameOver = true
    sim.emit('game:over', { cause: 'event' })
  }
}

/** Spec §4.1 / §7.2: the sell refund of a vehicle (whole dollars). */
export function sellRefund(sim: Sim, v: Vehicle): number {
  return Math.round(v.purchasePrice * sim.data.economy.sellRefund)
}

// Debug (ViewSim debug.forceMalwareDelivery; debug builds, shots) -----------------------

/**
 * Deliver a malware parcel now (the lost-life card without waiting): a new
 * parcel of the first announced strain with a plausible path through the
 * current lane (each live slot "missed" or "empty") — then the normal
 * delivery, so `parcel:delivered {malware}` and `life:lost` fire as in play.
 */
export function debugMalwareDelivery(sim: Sim): void {
  const s = sim.state
  const data = sim.data
  const strain: Strain =
    data.parcels.malware.strains.find(
      (x) => s.level.announced[x.id] !== undefined,
    )?.id ?? 'metal'
  const p = debugParcel(sim, s.nextId.parcel, true, strain)
  const v = s.vehicles[0] ?? null
  appendDebugRoute(sim, p, v)
  deliverParcel(sim, v, p)
}

/**
 * A debug parcel's plausible route up to its outbound leg, back-dated from
 * now: spawned 60 s ago, picked up by `v` (45 s), unloaded at dock1 (30 s),
 * each live slot "missed" or "empty" (28 s), shelved (25 s), loaded onto `v`
 * (15 s). Shared by debugMalwareDelivery and (M8) hubs.ts
 * debugOverseasMalware.
 */
export function appendDebugRoute(sim: Sim, p: Parcel, v: Vehicle | null): void {
  const s = sim.state
  const data = sim.data
  const at = (secondsAgo: number): number =>
    Math.max(0, s.tick - secondsAgo * TICKS_PER_S)
  p.spawnedTick = at(60)
  const spawned = p.trace[0]
  if (spawned) spawned.tick = p.spawnedTick
  p.trace.push({
    tick: at(45),
    what: 'pickedUp',
    ref: v ? String(v.id) : null,
    text: v ? `Picked up by ${v.name}` : 'Picked up',
  })
  p.trace.push({ tick: at(30), what: 'unloaded', ref: 'dock1' })
  for (const id of liveSlotIds(s.lane)) {
    const node = laneNode(s.lane, id)
    if (!node) continue
    const c = isActiveSlot(node) ? (node.fixture?.checker ?? null) : null
    p.trace.push(slotResultEntry(data, at(28), node, c, p, null))
  }
  p.trace.push({ tick: at(25), what: 'shelved', ref: s.lane.shelfNodeId })
  p.trace.push({
    tick: at(15),
    what: 'loaded',
    ref: v ? String(v.id) : null,
    text: v ? `Loaded onto ${v.name}` : 'Loaded',
  })
}
