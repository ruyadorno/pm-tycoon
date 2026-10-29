// Money flows of the city loop (spec §7.2-§7.3): a local delivery pays
// round(base × f(t)) at the stop (lifetime earned, district `earned`,
// money:changed 'delivery'); malware delivered pays $0 and costs the
// destination district malwareDelivered satisfaction (the life loss is M2,
// SIM_FEATURES.lives); a sold vehicle refunds economy.sellRefund × its price
// ('refund', never lifetime earned). Purchases go through Sim.debit in the
// command handlers. The balance never goes negative (Sim.debit throws).

import { SIM_FEATURES } from '../features.ts'
import { districtDef } from '../map.ts'
import type { Sim } from '../sim.ts'
import type { Parcel, Vehicle } from '../types.ts'
import { ageS, isOnTime, paidValue } from '../value.ts'
import { changeSatisfaction } from './satisfaction.ts'

/**
 * Deliver one parcel at its destination stop (§4.5 step 3, §7.3, §9.1):
 * parcel:delivered {paid, onTime, malware}, then the payout and the
 * satisfaction delta (on time: +onTime, +favouredBonus by the district's
 * favoured vehicle; late: −late; malware: −malwareDelivered, paid 0).
 */
export function deliverParcel(sim: Sim, v: Vehicle, p: Parcel): void {
  const s = sim.state
  const data = sim.data
  const sat = data.economy.satisfaction
  const onTime = isOnTime(data, ageS(p, s.tick))
  const paid = p.malware ? 0 : paidValue(data, p, s.tick)
  p.state = 'delivered'
  p.vehicleId = null
  p.reservedBy = null
  p.trace.push({ tick: s.tick, what: 'delivered', ref: p.dest })
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
    if (SIM_FEATURES.lives) {
      // TODO(M2): life:lost with the LostLifeReport, lastLostLife,
      // daysSinceIncident = 0, game:over at 0 lives (spec §10).
    }
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
    const favoured = districtDef(data, district).favoured.includes(v.type)
    changeSatisfaction(
      sim,
      district,
      sat.onTime + (favoured ? sat.favouredBonus : 0),
      'positive',
    )
  } else {
    changeSatisfaction(sim, district, sat.late, 'other')
  }
}

/** Spec §4.1 / §7.2: the sell refund of a vehicle (whole dollars). */
export function sellRefund(sim: Sim, v: Vehicle): number {
  return Math.round(v.purchasePrice * sim.data.economy.sellRefund)
}
