// The Hold Bay station (spec-build2 §2.6; plan-build2 §8.3 task 5; tick step
// 7): a station next to the Hold Bay rack seats ONE of a Sorter (a person,
// from L2 — employees.json holdStation.unlockLevel) or the Sorter Arm (a
// machines.json upgrade, from L4). Never both; both are Toss-only — only the
// player Clears (Q-B2-3, `roles.sorter.canClear: false` is schema-forced and
// this module has no clear path).
//
// Sorter (an active, seated employee; nothing while walked out, while absent
// — build 3, B3 §3.5 — or after game over): its candidate is the OLDEST held
// parcel (Hold Bay arrival order)
// that is not magic, not yet judged (`sorted`) and not touched by the player
// in the last playerGraceS. The clock starts when a candidate waits
// (nextDecisionTick = now + decisionS by pace — so a parcel never vanishes on
// the tick it arrives, design D4); when it rings the sorter decides on the
// candidate of that moment:
//   - its label is on the wanted list (state.wanted) → Toss with certainty
//     (no draw, `viaWanted`);
//   - else one main-stream draw `correct` (by judgement): judged malware →
//     Toss (bounty, or the wrong-Toss fee and satisfaction hit); judged clean
//     → left in the bay, marked judged (Parcel.sorted) — with
//     `roles.sorter.tagsClean` the mark shows as a `looks clean` tag
//     (HoldBayItem.sorted, the lost-life card's sorterCall) and a trace line;
//     without it nothing shows — a missed malware simply stays held for the
//     player.
// `sorter:decided` after each call; the clock re-arms only while another
// candidate waits. A player Toss / Clear / touch restarts a running clock
// (people.ts restartSorterClock), so the player's tap always wins.
//
// Sorter Arm (design §4.3, the single source of the Arm rule; reached at
// M6 only through debug.forceLevel(4), since M9 at the real L4 — the
// shipped cap 5, design-m8-m9 §4.6): no rng, no salary — every held
// non-magic parcel whose arrival (or last player touch) is autoTossDelayS
// old is tossed this tick, oldest first (`source: 'arm'`; decoys pay the
// wrong-Toss fee).

import type { GameData } from '../../data/types.ts'
import type { Sim } from '../sim.ts'
import type { Parcel } from '../types.ts'
import { isAbsent, ticksFromS } from '../types.ts'
import { tossParcel } from './holdbay.ts'
import { holdNode } from './lane.ts'
import { employeeById, sorterNumbers } from './people.ts'

/** The Sorter Arm's machines.json upgrade id. */
export const SORTER_ARM_ID = 'sorter_arm'

const heldParcels = (sim: Sim): Parcel[] =>
  holdNode(sim.state.lane).queue.flatMap((id) => {
    const p = sim.state.parcels[String(id)]
    return p && p.state === 'held' ? [p] : []
  })

/** employees.json roles.sorter.playerGraceS in ticks. */
export function playerGraceTicks(data: GameData): number {
  return ticksFromS(data.employees.roles.sorter.playerGraceS)
}

/**
 * The open HoldBayCard's renewal rule (B2 §2.6 "the player's tap always
 * wins"): renew the touch at sim tick `now` (last sent at `last`) every half
 * `graceTicks` (≥ 1 tick), so the grace never lapses while the player reads
 * the card — the per-frame check runs well inside it at any sim speed. A
 * sim that went back in time (a load) renews at once. The renewals only
 * extend the grace (commands.ts touchHeld): the sorter keeps calling the
 * other parcels, the Sorter Arm's 3 s keeps restarting for this one.
 */
export function touchRenewDue(
  now: number,
  last: number,
  graceTicks: number,
): boolean {
  return now < last || now - last >= Math.max(1, Math.floor(graceTicks / 2))
}

/** The sorter's next parcel: the oldest held, unjudged, non-magic one outside the player grace. */
export function sorterCandidate(sim: Sim): Parcel | null {
  const s = sim.state
  const grace = playerGraceTicks(sim.data)
  for (const p of heldParcels(sim)) {
    if (p.magic || p.sorted !== undefined) continue
    if (p.touchedTick !== undefined && s.tick - p.touchedTick < grace) continue
    return p
  }
  return null
}

/** Tick step 7: the seated sorter or the Sorter Arm. */
export function holdStationStep(sim: Sim): void {
  const hs = sim.state.lane.holdStation
  if (hs.fixture === null) return
  if (sim.state.economy.gameOver) {
    hs.nextDecisionTick = null
    return
  }
  if (hs.fixture === SORTER_ARM_ID) armStep(sim)
  else sorterStep(sim, hs.fixture)
}

function sorterStep(sim: Sim, employeeId: number): void {
  const s = sim.state
  const hs = s.lane.holdStation
  const e = employeeById(s, employeeId)
  // Build 3 (B3 §3.5): an absent sorter (an event sent them home) calls
  // nothing until effects.ts absenceStep brings them back.
  if (!e || !e.active || isAbsent(e, s.tick)) {
    hs.nextDecisionTick = null
    return
  }
  const role = sim.data.employees.roles.sorter
  const { correct: correctP, decisionTicks } = sorterNumbers(sim.data, e.pips)
  if (hs.nextDecisionTick === null) {
    if (sorterCandidate(sim)) hs.nextDecisionTick = s.tick + decisionTicks
    return
  }
  if (s.tick < hs.nextDecisionTick) return
  const p = sorterCandidate(sim)
  if (!p) {
    hs.nextDecisionTick = null
    return
  }
  const viaWanted = role.usesWantedList && s.wanted.includes(p.label)
  const correct = viaWanted ? true : sim.rng.chance(correctP)
  const judgedMalware = viaWanted || (correct ? p.malware : !p.malware)
  if (judgedMalware) {
    tossParcel(sim, p, { source: 'sorter', employeeId: e.id })
  } else {
    const pct = Math.round(100 * correctP)
    p.sorted = { by: e.id, name: e.name, pct }
    if (role.tagsClean) {
      p.trace.push({
        tick: s.tick,
        what: 'sorted',
        ref: s.lane.holdBayNodeId,
        text: `${e.name}: looks clean (${pct}%)`,
      })
    }
  }
  sim.emit('sorter:decided', {
    parcelId: p.id,
    employeeId: e.id,
    call: judgedMalware ? 'toss' : 'leave',
    correct,
    viaWanted,
  })
  hs.nextDecisionTick = sorterCandidate(sim) ? s.tick + decisionTicks : null
}

/** The Sorter Arm's auto-Toss delay in ticks (machines.json upgrades). */
export function armDelayTicks(sim: Sim): number {
  const def = sim.data.machines.upgrades.find((u) => u.id === SORTER_ARM_ID)
  return ticksFromS(def?.autoTossDelayS ?? 0)
}

function armStep(sim: Sim): void {
  const tick = sim.state.tick
  const delay = armDelayTicks(sim)
  const due = heldParcels(sim)
    .filter((p) => {
      if (p.magic) return false
      const enter = p.nodeEnterTick ?? tick
      const from = Math.max(enter, p.touchedTick ?? enter)
      return tick - from >= delay
    })
    .toSorted(
      (a, b) => (a.nodeEnterTick ?? 0) - (b.nodeEnterTick ?? 0) || a.id - b.id,
    )
  for (const p of due) {
    tossParcel(sim, p, { source: 'arm', employeeId: null })
  }
}
