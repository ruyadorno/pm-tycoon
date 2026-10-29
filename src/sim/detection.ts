// Checkers and detection (spec §6.3, §5.4, §5.5, §10; plan.md §12.5 task 2).
//
// One roll per parcel per checker, on exit (lane.ts calls rollChecker when a
// station's process time is up):
//   - malware: flagged with p(strain) = pMatch when the checker's strain is
//     the parcel's, else pOther (inspector desk and X-ray are generalists:
//     strain 'any', one p for every strain);
//   - clean with a decoy trait the checker matches (generalists: any trait):
//     flagged with decoyFlag;
//   - clean without a matching trait: never flagged (no draw);
//   - magic parcels: checkers skip them (no roll, §5.5);
//   - the scripted first malware (§5.4 forcedCatch): the first checker it
//     reaches flags it with certainty (no draw);
//   - a pending debug forceFlagNext flags whatever finishes next (no draw).
// The desk's 1-3 inspectors are parallel stations; each parcel is still
// rolled once with the desk's p, so a 3-inspector desk catches 85 % like one
// (§6.3 "one shared roll"): stations buy throughput, never detection.
//
// Readouts (also re-exported by view-api.ts with their M0 signatures):
// D(s) = 1 − Π(1 − p_i(s)) over the live slots with ≥ 1 station, the lane
// rate = min over those slots of stations / processTime capped by the docks,
// and the lost-life report (§10) with its counter-machine "what if".

import type { CheckerDef, GameData, StrainId } from '../data/types.ts'
import type { Sim } from './sim.ts'
import type {
  Checker,
  Lane,
  LaneNode,
  LostLifeReport,
  Parcel,
  SimState,
  Strain,
  TraceEntry,
} from './types.ts'
import { laneNode, liveSlotIds, TICKS_PER_S, ticksFromS } from './types.ts'

// §6.3 rates -------------------------------------------------------------------------

/** p(strain) of one checker: pMatch on its strain (generalists: always), else pOther. */
export function checkerP(c: Checker, strain: Strain): number {
  return c.strain === 'any' || c.strain === strain ? c.pMatch : c.pOther
}

/** Live slots whose fixture has ≥ 1 station (a desk with no inspector passes parcels through). */
export function activeCheckers(lane: Lane): { node: LaneNode; c: Checker }[] {
  const out: { node: LaneNode; c: Checker }[] = []
  for (const id of liveSlotIds(lane)) {
    const node = laneNode(lane, id)
    if (node?.fixture && node.stations.length > 0) {
      out.push({ node, c: node.fixture.checker })
    }
  }
  return out
}

/** Series compounding: 1 − Π(1 − p_i). */
export function compound(ps: readonly number[]): number {
  let miss = 1
  for (const p of ps) miss *= 1 - p
  return 1 - miss
}

/** D(s) = 1 − Π(1 − p_i(s)) over the active checkers (+ `extra`, for "what if"). */
export function laneCatchRate(
  lane: Lane,
  strain: Strain,
  extra: readonly Checker[] = [],
): number {
  return compound([
    ...activeCheckers(lane).map(({ c }) => checkerP(c, strain)),
    ...extra.map((c) => checkerP(c, strain)),
  ])
}

/** Strains whose level ≤ the company level, in parcels.json order. */
export function activeStrains(data: GameData, level: number): StrainId[] {
  return data.parcels.malware.strains
    .filter((s) => s.level <= level)
    .map((s) => s.id)
}

/**
 * Strains announced so far (LevelState.announced, the L1 strain at tick 0),
 * in parcels.json order — the "active strains" the §6.3 Detection % averages.
 */
export function announcedStrains(state: SimState, data: GameData): Strain[] {
  return data.parcels.malware.strains
    .filter((s) => state.level.announced[s.id] !== undefined)
    .map((s) => s.id)
}

/**
 * Lane rate in parcels/min (spec §6.3): min over active checkers of
 * stations / processS, capped by the loading docks (dockUnloadPerS each).
 */
export function laneRatePerMin(lane: Lane, data: GameData): number {
  const dockCap = lane.docks.length * data.vehicles.dockUnloadPerS * 60
  let rate = dockCap
  for (const { node, c } of activeCheckers(lane)) {
    const perMin = (node.stations.length * 60 * TICKS_PER_S) / c.processTicks
    rate = Math.min(rate, perMin)
  }
  return rate
}

/** A Checker built from a machines.json row (bought now, or a "what if"). */
export function machineChecker(
  def: CheckerDef,
  id: string,
  boughtTick: number,
): Checker {
  return {
    id,
    kind: 'machine',
    defId: def.id,
    strain: def.strain,
    pMatch: def.pMatch,
    pOther: def.pOther,
    decoyFlag: def.decoyFlag,
    processTicks: ticksFromS(def.processS),
    stations: 1,
    price: def.price,
    boughtTick,
  }
}

// The roll ----------------------------------------------------------------------------

/** What this checker's roll can flag on this parcel and how likely; null = never (no draw). */
export function flagChance(
  c: Checker,
  p: Pick<Parcel, 'malware' | 'strain' | 'decoy' | 'magic'>,
): { p: number; strain: Strain } | null {
  if (p.magic) return null
  if (p.malware) {
    return p.strain === null
      ? null
      : { p: checkerP(c, p.strain), strain: p.strain }
  }
  if (p.decoy !== null && (c.strain === 'any' || c.strain === p.decoy)) {
    return { p: c.decoyFlag, strain: p.decoy }
  }
  return null
}

/**
 * The one roll on exit (§6.3): the trait flagged (the malware strain or the
 * decoy trait), or null. Draws from the sim rng only for a real chance.
 */
export function rollChecker(sim: Sim, c: Checker, p: Parcel): Strain | null {
  if (p.magic) return null
  const lane = sim.state.lane
  const forced = lane.debugForceFlag
  if (forced !== undefined) {
    delete lane.debugForceFlag
    return forced
  }
  if (p.scripted && p.malware && p.strain !== null) return p.strain
  const f = flagChance(c, p)
  if (!f) return null
  return sim.rng.chance(f.p) ? f.strain : null
}

// Card text (§10 lost-life path) ---------------------------------------------------------

const pct = (x: number): number => Math.round(100 * x)

/** 'slot2' → 'Slot 2' (other node ids unchanged). */
export function slotLabel(nodeId: string | null): string {
  const m = /^slot(\d+)$/.exec(nodeId ?? '')
  return m ? `Slot ${m[1]}` : (nodeId ?? '')
}

/** "Metal detector" (machines.json name) or "Inspection desk". */
export function checkerName(data: GameData, c: Checker): string {
  if (c.kind === 'desk') return 'Inspection desk'
  return data.machines.checkers.find((d) => d.id === c.defId)?.name ?? c.defId
}

/**
 * The trace entry of a parcel leaving a slot (one per slot, ref = node id):
 * 'empty' (no station), 'skipped' (magic), 'flagged', 'missed' (malware not
 * flagged — with the checker's p vs its strain) or 'passed' (clean).
 */
export function slotResultEntry(
  data: GameData,
  tick: number,
  node: LaneNode,
  c: Checker | null,
  p: Parcel,
  flagged: Strain | null,
): TraceEntry {
  const where = slotLabel(node.id)
  if (c === null) {
    return { tick, what: 'empty', ref: node.id, text: `${where}: empty` }
  }
  const name = `${where} ${checkerName(data, c)}`
  if (p.magic) {
    return { tick, what: 'skipped', ref: node.id, text: `${name}: skipped` }
  }
  // The checker that rolled, and (malware) its p vs the strain — §10's
  // "your lane's catch rate was N %" is the D this parcel actually faced.
  const rolled: Pick<TraceEntry, 'chk' | 'p'> =
    p.malware && p.strain !== null
      ? { chk: c.id, p: checkerP(c, p.strain) }
      : { chk: c.id }
  if (flagged !== null) {
    return {
      tick,
      what: 'flagged',
      ref: node.id,
      text: `${name}: flagged (${flagged})`,
      ...rolled,
    }
  }
  if (p.malware && p.strain !== null) {
    return {
      tick,
      what: 'missed',
      ref: node.id,
      text: `${name}: missed (${pct(checkerP(c, p.strain))}% vs ${p.strain})`,
      ...rolled,
    }
  }
  return {
    tick,
    what: 'passed',
    ref: node.id,
    text: `${name}: passed`,
    ...rolled,
  }
}

/** This checker already rolled this parcel (one roll per parcel per checker, §6.3). */
export function rolledBy(p: Parcel, checkerId: string): boolean {
  return p.trace.some((t) => t.chk === checkerId)
}

/**
 * The checkers a malware parcel was rolled at (its 'missed' / 'flagged'
 * slot results) with each one's p vs its strain — or null when an older
 * save's trace does not carry them.
 */
function facedRolls(p: Parcel): { chk: string; p: number }[] | null {
  const out: { chk: string; p: number }[] = []
  for (const t of p.trace) {
    if (t.what !== 'missed' && t.what !== 'flagged') continue
    if (t.chk === undefined || t.p === undefined) return null
    out.push({ chk: t.chk, p: t.p })
  }
  return out
}

function buildingName(data: GameData, id: string | null): string {
  return data.buildings.find((b) => b.id === id)?.name ?? id ?? '?'
}

/** The card line of a trace entry that did not store one. */
export function traceText(data: GameData, t: TraceEntry): string {
  if (t.text !== undefined) return t.text
  switch (t.what) {
    case 'spawned':
      return `Spawned at ${buildingName(data, t.ref)}`
    case 'pickedUp':
      return 'Picked up'
    case 'unloaded':
      return 'Unloaded'
    case 'slot':
      return slotLabel(t.ref)
    case 'empty':
      return `${slotLabel(t.ref)}: empty`
    case 'held':
      return 'Held in the Hold Bay'
    case 'cleared':
      return 'Cleared by you'
    case 'tossed':
      return 'Tossed'
    case 'shelved':
      return 'Shelved'
    case 'returned':
      return 'Returned to the shelf'
    case 'loaded':
      return 'Loaded'
    case 'delivered':
      return `Delivered to ${buildingName(data, t.ref)}`
    default:
      return t.what
  }
}

// The lost-life report (§10) ------------------------------------------------------------

/**
 * Everything the lost-life card shows: the label and strain, the path (every
 * hop with its tick and card line), the lane rate (`laneRate`), the strain's
 * counter machine (parcels.json strains[].counter), whether the lane held
 * one (`counterOwned`), D with one more of it (`counterRate` — "a Shaky
 * shaker would make it 83 %", or with a second unit when owned), and the
 * tick the player cleared it, if they did.
 *
 * The rates are those of the lane THIS parcel went through (§10 "your
 * lane's catch rate vs rattle WAS 15 %"; city-view.md §9.3 "this one got
 * through on the 17 %"): D = 1 − Π(1 − p) over the checkers it was rolled
 * at (its 'missed' / 'flagged' slot results carry each checker's p), and
 * counterOwned = one of them was the counter machine — so the card agrees
 * with its own path even when the player changed the lane after the parcel
 * passed. A parcel the player cleared (its rolls stopped at the flag) and
 * an older save's trace without the p values use the lane as it stands.
 */
export function lostLifeReport(
  sim: Sim,
  p: Parcel,
  viaClearance: boolean,
): LostLifeReport {
  const s = sim.state
  const data = sim.data
  const lane = s.lane
  const strain = p.strain
  const counterMachineId =
    strain === null
      ? null
      : (data.parcels.malware.strains.find((x) => x.id === strain)?.counter ??
        null)
  const counterDef =
    counterMachineId === null
      ? null
      : (data.machines.checkers.find((c) => c.id === counterMachineId) ?? null)
  const counter =
    counterDef === null
      ? null
      : machineChecker(counterDef, `counter:${counterDef.id}`, s.tick)
  const cleared = p.trace.findLast((t) => t.what === 'cleared')
  // A cleared parcel's rolls stop at the flag (the Clear skipped the rest):
  // its card leads with "Cleared by you", the rates are the lane's now.
  const faced = cleared ? null : facedRolls(p)
  let laneRate: number
  let counterOwned: boolean
  let counterRate: number | null
  if (faced !== null) {
    const ps = faced.map((x) => x.p)
    laneRate = strain === null ? 0 : compound(ps)
    counterOwned =
      counterMachineId !== null &&
      faced.some((x) => checkerDefOf(data, lane, p, x.chk) === counterMachineId)
    counterRate =
      strain === null || counter === null
        ? null
        : compound([...ps, checkerP(counter, strain)])
  } else {
    laneRate = strain === null ? 0 : laneCatchRate(lane, strain)
    counterOwned =
      counterMachineId !== null &&
      activeCheckers(lane).some(({ c }) => c.defId === counterMachineId)
    counterRate =
      strain === null || counter === null
        ? null
        : laneCatchRate(lane, strain, [counter])
  }
  return {
    tick: s.tick,
    parcelId: p.id,
    label: p.label,
    strain,
    size: p.size,
    originBuildingId: p.origin,
    destBuildingId: p.dest,
    path: p.trace.map((t) => ({
      tick: t.tick,
      what: t.what,
      ref: t.ref,
      text: traceText(data, t),
    })),
    laneRate,
    counterMachineId,
    counterOwned,
    counterRate,
    clearedByPlayerAt: cleared ? cleared.tick : null,
    livesLeft: s.economy.lives,
    viaClearance,
  }
}

/**
 * The machines.json id of the checker `chk` that rolled this parcel: the
 * fixture still holding that Checker, else the machine named in the slot
 * result's card line (the fixture was removed since); null for the desk.
 */
function checkerDefOf(
  data: GameData,
  lane: Lane,
  p: Parcel,
  chk: string,
): string | null {
  for (const n of lane.nodes) {
    if (n.fixture?.checker.id === chk) return n.fixture.checker.defId
  }
  const t = p.trace.find((x) => x.chk === chk)
  const m = /^Slot \d+ (.+): (missed|flagged)/.exec(t?.text ?? '')
  return data.machines.checkers.find((d) => d.name === m?.[1])?.id ?? null
}
