// Build 3 M13 — the shipped deck's stories, card by card (plan-build3 §8.4
// task 4 and its acceptance; spec-build3 §3.3, §3.5, §3.7, §4): every chain
// of the shipped events.json is played through decideEvent on a deck-off
// sim (no draw, no job, no rescue: only the links its own answers book),
// with a deterministic setup that puts the head in the real draw pool
// (decisionCandidates: its level, cond, target and pick met) before it is
// offered.
//
//   - The 4–5-card stories end to end, and every other chain too: the gang
//     (Refuse → watch → Carry on → `vehicle:lost` bike → the price went up → the
//     police → the raid's wanted reveal and the life back), the union, the
//     rival (five cards), the investor, the permit / petition hearing, the
//     audit, the ring, the crate, the storm, the influencer, the port
//     strike and the pairs; every answer of every chain card is played by
//     some story (the coverage test at the end, computed from the deck).
//   - Conditional branches both ways, flipped AFTER the booking so the
//     branch is the one that holds when due (B3 §3.7): the audit by catch
//     rate (and its router by flag or rate), the VIP / influencer by their
//     district's happiness, the award / review / hearing by the average,
//     the spot check by catch rate, the storm and the ring by flag.
//   - A link whose cond fails when due is dropped (the poach, the steeper
//     audit fine, the registry's fine, the dead gearbox): no card, nothing
//     left scheduled, the story never "ends".
//   - Each answer is checked against its data (decide()'s honesty check,
//     recomputed here, not through effects.ts): the cost and money in data
//     order (moneyPct on the running balance, a lost vehicle's fallback),
//     lives, flags, the modifier rows (key, mult / add, scope, untilTick),
//     an `end`, the wanted reveal, vehicles lost / gained (a gift's driver),
//     quits, ★ applicants, absences, pips, shelf parcels lost, happiness per
//     district, and every link booked (due tick, parent label, head, depth,
//     the inherited target and pick); a link opens on its due tick at
//     depth + 1 with "You chose" = the parent's label.
//
// Options are found by their effects, never their labels (copy edits leave
// these stories alone); numbers come from the data (the pacing passes move
// them under this test).

import { describe, expect, it } from 'vitest'
import type {
  EventDef,
  EventEffect,
  EventOptionDef,
  StrainId,
} from '../../src/data/types.ts'
import { modMult } from '../../src/sim/modifiers.ts'
import type { Sim } from '../../src/sim/sim.ts'
import { auditState } from '../../src/sim/sim.ts'
import {
  cardOptions,
  condHolds,
  decisionCandidates,
  fillCardText,
} from '../../src/sim/systems/deck.ts'
import { resyncDesks } from '../../src/sim/systems/people.ts'
import { liveSpawningDistricts } from '../../src/sim/systems/satisfaction.ts'
import type {
  Modifier,
  OpenCard,
  Pips,
  ScheduledLink,
} from '../../src/sim/types.ts'
import {
  laneNode,
  liveSlotIds,
  TICKS_PER_DAY,
  ticksFromS,
} from '../../src/sim/types.ts'
import {
  buy,
  collect,
  dataFixture,
  decideOpen,
  eventLog,
  fund,
  hireInspector,
  placeMachine,
  quietSim,
  runTicks,
  runUntil,
  shelveParcel,
  unlockDistrict,
} from './helpers.ts'

const data = dataFixture()
const DAY = TICKS_PER_DAY
const FIRST = ticksFromS(data.events.schedule.firstEventS)
const LINK_WAIT = (data.events.schedule.linkMaxDays + 1) * DAY
const FUNDS = 20_000
const SAT = data.economy.satisfaction
const deck: readonly EventDef[] = data.events.deck
const byId = new Map(deck.map((d) => [d.id, d]))

function cardDef(id: string): EventDef {
  const d = byId.get(id)
  if (!d) throw new Error(`no card ${id} in the shipped deck`)
  return d
}

// Options by structure ------------------------------------------------------------

type Pred = (o: EventOptionDef) => boolean
type Effect<K extends EventEffect['kind']> = Extract<EventEffect, { kind: K }>

/** The option books `id` (a plain next, or one of a conditional next's branches). */
const books =
  (id: string): Pred =>
  (o) =>
    o.effects.some(
      (e) =>
        e.kind === 'next' &&
        ('branches' in e
          ? e.branches.some((b) => b.id === id)
          : e.eventId === id),
    )
/** The option has an effect of `kind` (matching `f`). */
const has =
  <K extends EventEffect['kind']>(
    kind: K,
    f: (e: Effect<K>) => boolean = () => true,
  ): Pred =>
  (o) =>
    o.effects.some((e) => e.kind === kind && f(e as Effect<K>))
const paid: Pred = (o) => (o.cost ?? 0) > 0 || o.costPerVehicle !== undefined
const free: Pred = (o) => !paid(o)
const noLink: Pred = (o) => !o.effects.some((e) => e.kind === 'next')
const nothing: Pred = (o) => o.effects.length === 0 && free(o)
const only: Pred = () => true
const and =
  (...ps: Pred[]): Pred =>
  (o) =>
    ps.every((p) => p(o))
const not =
  (p: Pred): Pred =>
  (o) =>
    !p(o)
const setsFlag = (flag: string): Pred =>
  has('flag', (e) => 'set' in e && e.set === flag)
const losesLife: Pred = has('lives', (e) => e.delta < 0)
const losesVehicle = (type: string): Pred =>
  has('vehicle', (e) => 'lose' in e && e.lose === type)
const gainsVehicle: Pred = has('vehicle', (e) => 'gain' in e)
const mod = (key: string): Pred => has('mod', (e) => e.key === key)

/** The one option of `id` matching `p` (a story names an answer unambiguously). */
function optionIndex(id: string, p: Pred): number {
  const opts = cardDef(id).options ?? []
  const hits = opts.flatMap((o, i) => (p(o) ? [i] : []))
  if (hits.length !== 1)
    throw new Error(`${id}: ${hits.length} options match the story's answer`)
  return hits[0]!
}

// Setups ----------------------------------------------------------------------------

/** A quiet deck-off sim past the first firstEventS (links wait it out like any card), at `level`, funded. */
function playing(seed: number, level: number): Sim {
  const sim = quietSim(seed)
  runTicks(sim, FIRST)
  sim.state.level.level = level
  return fund(sim, FUNDS)
}

/** Every live spawning district's happiness = v (a conditional reads it when due). */
const setSat =
  (v: number) =>
  (sim: Sim): void => {
    for (const d of liveSpawningDistricts(sim))
      sim.state.districts[d]!.satisfaction = v
  }

/** The pending link's inherited target district's happiness = v. */
const setTargetSat =
  (v: number) =>
  (sim: Sim): void => {
    const t = sim.state.events.scheduled[0]?.target
    if (!t) throw new Error('no pending link with a target')
    sim.state.districts[t]!.satisfaction = v
  }

const rate95 = (sim: Sim): boolean =>
  condHolds(sim, { laneRateAtLeast: 0.95 }, { target: null, pick: null })

/** A Metal detector in the first free live slot: the L1 lane (one desk) reaches 95 % vs metal. */
function fixLane(sim: Sim): void {
  expect(rate95(sim), 'the desk alone is under 95 %').toBe(false)
  const lane = sim.state.lane
  const slot = liveSlotIds(lane).find(
    (id) => laneNode(lane, id)?.fixture === null,
  )
  if (!slot) throw new Error('no free slot')
  placeMachine(sim, 'metal_detector', slot)
  fund(sim, FUNDS)
  expect(rate95(sim), 'the lane with a detector is at 95 %+').toBe(true)
}

/** The lane stays under 95 % until the link is due. */
function laneUnder(sim: Sim): void {
  expect(rate95(sim)).toBe(false)
}

/** The balance one dollar under `amount` (a link's balanceAtLeast fails when due). */
const brokeBelow =
  (amount: number) =>
  (sim: Sim): void => {
    sim.state.economy.balance = amount - 1
  }

function balanceAtLeastOf(id: string): number {
  const v = cardDef(id).cond?.balanceAtLeast
  if (v === undefined) throw new Error(`${id} has no balanceAtLeast`)
  return v
}

// The honesty check -----------------------------------------------------------------

interface Pre {
  tick: number
  balance: number
  lives: number
  flags: Record<string, true>
  modifiers: Modifier[]
  wanted: number
  revealable: number
  vehicles: {
    id: number
    type: string
    boughtTick: number
    driverId: number | null
  }[]
  employees: {
    id: number
    role: string
    active: boolean
    nodeId: string | null
    vehicleId: number | null
    pips: Pips
  }[]
  sat: Record<string, number>
  live: string[]
  scheduled: number
  losableShelf: number
}

function revealableCount(sim: Sim): number {
  const s = sim.state
  const out = new Set<string>()
  for (const st of Object.keys(s.level.announced) as StrainId[]) {
    for (const label of sim.data.puns.malwareLabels[st] ?? []) {
      if (!s.wanted.includes(label)) out.add(label)
    }
  }
  return out.size
}

function losableShelfCount(sim: Sim): number {
  const s = sim.state
  const shelf = laneNode(s.lane, s.lane.shelfNodeId)
  if (!shelf) return 0
  return shelf.queue.filter((id) => {
    const p = s.parcels[String(id)]
    return (
      p !== undefined &&
      p.state === 'on_shelf' &&
      p.reservedBy === null &&
      !p.magic
    )
  }).length
}

function snapshot(sim: Sim): Pre {
  const s = sim.state
  const live = liveSpawningDistricts(sim)
  return {
    tick: s.tick,
    balance: s.economy.balance,
    lives: s.economy.lives,
    flags: { ...s.events.flags } as Record<string, true>,
    modifiers: structuredClone(s.modifiers),
    wanted: s.wanted.length,
    revealable: revealableCount(sim),
    vehicles: s.vehicles.map((v) => ({
      id: v.id,
      type: v.type,
      boughtTick: v.boughtTick,
      driverId: v.driverId,
    })),
    employees: s.employees.map((e) => ({
      id: e.id,
      role: e.role,
      active: e.active,
      nodeId: e.nodeId,
      vehicleId: e.vehicleId,
      pips: { ...e.pips },
    })),
    sat: Object.fromEntries(live.map((d) => [d, s.districts[d]!.satisfaction])),
    live,
    scheduled: s.events.scheduled.length,
    losableShelf: losableShelfCount(sim),
  }
}

/** people.ts pip(): charisma 0–2, the other stats 1–5. */
const clampPip = (stat: string, v: number): number =>
  stat === 'charisma'
    ? Math.min(2, Math.max(0, v))
    : Math.min(5, Math.max(1, v))

/** effects.ts applyMoney: a debit is clamped to the balance. */
const moneyStep = (bal: number, delta: number): number =>
  delta >= 0 ? bal + delta : bal - Math.min(-delta, bal)

type Logged = { tick: number; name: string; p: unknown }

/**
 * The answer did what its data says (recomputed from `pre`, effects in data
 * order): see the header. `label` is the option as shown (placeholders
 * filled) — the links' parentChoice.
 */
function expectHonest(
  sim: Sim,
  card: OpenCard,
  o: EventOptionDef,
  shownCost: number,
  label: string,
  pre: Pre,
  emitted: Logged[],
): void {
  const s = sim.state
  const tag = `${card.eventId} "${label}"`
  let bal = pre.balance - shownCost
  let lives = pre.lives
  const flags: Record<string, true> = { ...pre.flags }
  const sat = { ...pre.sat }
  const rows: Pick<Modifier, 'key' | 'mult' | 'add' | 'scope' | 'untilTick'>[] =
    []
  const ended = new Set<string>()
  let reveal = 0
  let livesLost = 0
  let parcelsLost = 0
  const fleet = [...pre.vehicles]
  const lost: number[] = []
  const gained: Effect<'vehicle'>[] = []
  const links: Omit<ScheduledLink, 'bookedTick'>[] = []
  const pipDelta = new Map<number, Pips>()
  for (const e of o.effects) {
    switch (e.kind) {
      case 'money':
        bal = moneyStep(bal, e.delta)
        break
      case 'moneyPerVehicle':
        bal = moneyStep(
          bal,
          e.delta *
            fleet.filter((v) => e.type === undefined || v.type === e.type)
              .length,
        )
        break
      case 'moneyPct': {
        const amount = Math.round(Math.abs(bal * e.pct))
        bal = moneyStep(bal, e.pct < 0 ? -amount : amount)
        break
      }
      case 'lives':
        if (e.delta > 0)
          lives = Math.min(sim.data.economy.lives.cap, lives + e.delta)
        else {
          const n = Math.min(-e.delta, lives)
          lives -= n
          livesLost += n
        }
        break
      case 'satisfaction': {
        const ds =
          e.scope === 'all'
            ? pre.live
            : e.scope === 'target'
              ? card.target !== null && pre.live.includes(card.target)
                ? [card.target]
                : []
              : pre.live.includes(e.scope)
                ? [e.scope]
                : null
        if (ds === null)
          throw new Error(
            `${tag}: satisfaction scope ${e.scope} is not checked here`,
          )
        for (const d of ds)
          sat[d] = Math.min(SAT.max, Math.max(SAT.min, sat[d]! + e.delta))
        break
      }
      case 'mod':
        rows.push({
          key: e.key,
          mult: e.mult ?? 1,
          add: e.add ?? 0,
          scope: e.scope === 'target' ? card.target : (e.scope ?? null),
          untilTick: e.days === undefined ? null : pre.tick + e.days * DAY,
        })
        break
      case 'cap':
        rows.push({
          key: 'shelfCap',
          mult: 1,
          add: e.add,
          scope: null,
          untilTick: null,
        })
        break
      case 'end':
        ended.add(e.eventId)
        break
      case 'flag':
        if ('set' in e) flags[e.set] = true
        else delete flags[e.clear]
        break
      case 'wanted':
        reveal += Math.max(0, e.reveal)
        break
      case 'vehicle':
        if ('lose' in e) {
          const of = fleet
            .filter((v) => e.lose === 'any' || v.type === e.lose)
            .toSorted((a, b) => a.boughtTick - b.boughtTick || a.id - b.id)[0]
          if (of) {
            fleet.splice(fleet.indexOf(of), 1)
            lost.push(of.id)
          } else bal = moneyStep(bal, e.fallback)
        } else gained.push(e)
        break
      case 'pips': {
        const targets = pre.employees.filter((x) =>
          e.scope === 'all'
            ? x.role === e.role
            : card.pick?.role === e.role && card.pick.id === x.id,
        )
        for (const x of targets) {
          const d = pipDelta.get(x.id) ?? {}
          d[e.stat] = (d[e.stat] ?? 0) + e.delta
          pipDelta.set(x.id, d)
        }
        break
      }
      case 'parcels':
        if ('lose' in e) parcelsLost += e.lose.count
        break
      case 'next':
        links.push({
          eventId: 'eventId' in e ? e.eventId : null,
          branches: 'branches' in e ? e.branches : null,
          dueTick: pre.tick + e.days * DAY,
          target: card.target,
          pick: card.pick,
          parentChoice: label,
          chainHeadId: card.chainHeadId!,
          depth: card.depth + 1,
        })
        break
      case 'staff':
      case 'job':
      case 'jobDecline':
        break
    }
  }

  expect(s.economy.balance, `${tag}: the balance`).toBe(bal)
  expect(s.economy.lives, `${tag}: lives`).toBe(lives)
  expect(
    emitted.filter(
      (x) =>
        x.name === 'life:lost' && (x.p as { cause?: string }).cause === 'event',
    ),
    `${tag}: life:lost (event)`,
  ).toHaveLength(livesLost)
  expect(s.events.flags, `${tag}: flags`).toEqual(flags)
  for (const d of pre.live) {
    expect(s.districts[d]!.satisfaction, `${tag}: ${d} happiness`).toBe(sat[d])
  }

  // Modifier rows: the new ones as data says; the ended gone; the rest kept.
  const preIds = new Set(pre.modifiers.map((m) => m.id))
  const fresh = s.modifiers.filter((m) => !preIds.has(m.id))
  expect(
    fresh.map((m) => ({
      key: m.key,
      mult: m.mult,
      add: m.add,
      scope: m.scope,
      untilTick: m.untilTick,
    })),
    `${tag}: modifier rows applied`,
  ).toEqual(rows)
  for (const m of fresh)
    expect(m.eventId, `${tag}: the row's card`).toBe(card.eventId)
  const kept = pre.modifiers
    .filter((m) => !ended.has(m.eventId))
    .map((m) => m.id)
  expect(
    s.modifiers.filter((m) => preIds.has(m.id)).map((m) => m.id),
    `${tag}: modifier rows kept (an end removes its card's rows)`,
  ).toEqual(kept)
  if (ended.size > 0) {
    expect(
      pre.modifiers.some((m) => ended.has(m.eventId)),
      `${tag}: the end had a row to end`,
    ).toBe(true)
  }

  expect(s.wanted.length - pre.wanted, `${tag}: the wanted reveal`).toBe(
    Math.min(reveal, pre.revealable),
  )
  expect(
    emitted.filter((x) => x.name === 'parcel:lost'),
    `${tag}: shelf parcels lost`,
  ).toHaveLength(Math.min(parcelsLost, pre.losableShelf))

  // Vehicles: the oldest of the type lost (vehicle:lost; its driver fired), the gifts parked or driven.
  const ids = new Set(s.vehicles.map((v) => v.id))
  for (const id of lost)
    expect(ids.has(id), `${tag}: vehicle ${id} lost`).toBe(false)
  expect(
    emitted
      .filter((x) => x.name === 'vehicle:lost')
      .map((x) => (x.p as { id: number }).id),
    `${tag}: vehicle:lost`,
  ).toEqual(lost)
  const newVehicles = s.vehicles.filter(
    (v) => !pre.vehicles.some((x) => x.id === v.id),
  )
  expect(
    newVehicles.map((v) => v.type),
    `${tag}: vehicles gained`,
  ).toEqual(gained.map((g) => ('gain' in g ? g.gain : '?')))
  newVehicles.forEach((v, i) => {
    const g = gained[i]!
    const withDriver = 'gain' in g ? g.withDriver : undefined
    if (withDriver === undefined) {
      expect(v.driverId, `${tag}: a driverless gift parks`).toBeNull()
      expect(v.state).toBe('inactive')
    } else {
      const d = s.employees.find((x) => x.id === v.driverId)
      expect(d?.role, `${tag}: the gift's volunteer drives it`).toBe('driver')
      expect(d?.name.startsWith(withDriver.name)).toBe(true)
      expect(d?.star).toBe(true)
    }
  })

  // Staff: quits, ★ applicants, absences.
  for (const e of o.effects) {
    if (e.kind !== 'staff') continue
    if ('quit' in e) {
      if (e.pick === 'one') {
        const p = card.pick
        const was = pre.employees.find(
          (x) => p?.role === e.quit && x.id === p.id && x.active,
        )
        if (was) {
          expect(
            s.employees.some((x) => x.id === was.id),
            `${tag}: ${p?.name} quits`,
          ).toBe(false)
          expect(
            emitted.some(
              (x) =>
                x.name === 'worker:fired' &&
                (x.p as { employeeId?: number; reason?: string }).reason ===
                  'event',
            ),
            `${tag}: worker:fired (event)`,
          ).toBe(true)
        }
      } else {
        expect(
          s.employees.filter((x) => x.role === e.quit).length,
          `${tag}: one ${e.quit} quits`,
        ).toBe(pre.employees.filter((x) => x.role === e.quit).length - 1)
      }
    } else if ('star' in e) {
      const a = s.applicants[e.star.role].find(
        (x) => x.star && (x.starKey ?? x.name) === e.star.name,
      )
      expect(
        a,
        `${tag}: ★ ${e.star.name} in the ${e.star.role} pool`,
      ).toBeDefined()
    } else {
      const until = pre.tick + e.days * DAY
      const away =
        e.pick === 'all'
          ? pre.employees.filter(
              (x) =>
                x.role === e.absent &&
                x.active &&
                (x.role !== 'inspector' || x.nodeId !== null),
            )
          : pre.employees.filter(
              (x) => card.pick?.role === e.absent && card.pick.id === x.id,
            )
      expect(away.length, `${tag}: someone to send away`).toBeGreaterThan(0)
      for (const x of away) {
        const now = s.employees.find((y) => y.id === x.id)
        expect(
          now?.absentUntilTick,
          `${tag}: ${x.id} away`,
        ).toBeGreaterThanOrEqual(until)
      }
    }
  }

  // Pips (clamped as people.ts does).
  for (const [id, d] of pipDelta) {
    const was = pre.employees.find((x) => x.id === id)!
    const now = s.employees.find((x) => x.id === id)!
    for (const [stat, delta] of Object.entries(d)) {
      expect(now.pips[stat as keyof Pips], `${tag}: ${now.name} ${stat}`).toBe(
        clampPip(stat, (was.pips[stat as keyof Pips] ?? 0) + (delta ?? 0)),
      )
    }
  }

  // The links booked: appended in data order.
  const booked = s.events.scheduled.slice(pre.scheduled)
  expect(
    booked.map(({ bookedTick, ...rest }) => {
      expect(bookedTick).toBe(pre.tick)
      return rest
    }),
    `${tag}: the links booked`,
  ).toEqual(links)
}

// The story runner ------------------------------------------------------------------

interface Step {
  id: string
  index: number
  label: string
  tick: number
  card: OpenCard
  booked: ScheduledLink[]
}

/** Answer the open card `id` with the option matching `p` (decideEvent), checked against its data. */
function decide(sim: Sim, id: string, p: Pred, log: Logged[]): Step {
  const card = sim.state.events.open
  expect(card?.eventId, 'the open card').toBe(id)
  const def = cardDef(id)
  const index = optionIndex(id, p)
  const o = def.options![index]!
  const shown = cardOptions(sim, card!)[index]!
  expect(shown.visible, `${id} "${shown.label}": shown`).toBe(true)
  expect(shown.affordable, `${id} "${shown.label}": affordable`).toBe(true)
  const pre = snapshot(sim)
  const from = log.length
  const decided = collect(sim, 'event:decided')
  decideOpen(sim, index)
  const emitted = log.slice(from)
  expect(decided[0]).toMatchObject({
    eventId: id,
    option: index,
    label: shown.label,
    default: o.default === true,
  })
  // A conditional next shows its hint among the generated lines (B3 §3.7).
  for (const e of o.effects) {
    if (e.kind === 'next' && 'branches' in e) {
      const hint = fillCardText(sim.data, e.hint, card!)
      expect(
        decided[0]!.effects.some((l) => l.includes(hint)),
        `${id}: the hint "${hint}" on the card`,
      ).toBe(true)
    }
  }
  expectHonest(sim, card!, o, shown.cost, shown.label, pre, emitted)
  expect(sim.state.events.open, `${id}: the slot frees`).toBeNull()
  return {
    id,
    index,
    label: shown.label,
    tick: pre.tick,
    card: card!,
    booked: sim.state.events.scheduled.slice(pre.scheduled),
  }
}

interface Move {
  card: string
  choose: Pred
  /** Runs once the previous card is answered, before this one is due (a branch resolves when due). */
  before?: (sim: Sim) => void
  /** Extra checks after the answer. */
  check?: (sim: Sim, step: Step, log: Logged[]) => void
}

interface Story {
  name: string
  level: number
  seed?: number
  setup?: (sim: Sim) => void
  /** moves[0] is the head. */
  moves: Move[]
  /** The last answer books a link; `drop` then breaks its cond: no card ever comes. */
  drop?: (sim: Sim) => void
}

function runStory(story: Story): Sim {
  const sim = playing(story.seed ?? 1, story.level)
  story.setup?.(sim)
  const log = eventLog(sim)
  const news = collect(sim, 'ticker:news')
  const head = story.moves[0]!.card
  const headDef = cardDef(head)
  const stats0 = { ...sim.state.events.stats }
  let prev: Step | null = null
  for (const m of story.moves) {
    if (prev === null) {
      // A head the real draw could deal now (level, cond, target, pick), then offered by debug.
      expect(
        decisionCandidates(sim).map((c) => c.def.id),
        `${story.name}: ${head} in the draw pool`,
      ).toContain(head)
      expect(sim.dispatch({ kind: 'debugOfferEvent', eventId: head })).toEqual({
        ok: true,
      })
      const open = sim.state.events.open!
      expect(open).toMatchObject({ eventId: head, depth: 1, chainHeadId: head })
      if (headDef.pick !== undefined) expect(open.pick?.role).toBe(headDef.pick)
      if (headDef.target !== undefined) expect(open.target).not.toBeNull()
    } else {
      m.before?.(sim)
      const link: ScheduledLink | undefined = prev.booked[0]
      expect(
        prev.booked,
        `${story.name}: ${prev.id} books one link`,
      ).toHaveLength(1)
      const ran = runUntil(sim, () => sim.state.events.open !== null, LINK_WAIT)
      expect(ran, `${story.name}: a card after ${prev.id}`).toBeGreaterThan(0)
      const open = sim.state.events.open!
      expect(open.eventId, `${story.name}: the card after ${prev.id}`).toBe(
        m.card,
      )
      expect(open).toMatchObject({
        kind:
          (cardDef(m.card).options?.length ?? 0) === 1 ? 'news' : 'decision',
        category: cardDef(m.card).category,
        chainHeadId: head,
        depth: prev.card.depth + 1,
        parentChoice: prev.label,
        target: prev.card.target,
        drawn: false,
      })
      if (
        cardDef(m.card).pick === undefined ||
        cardDef(m.card).pick === prev.card.pick?.role
      )
        expect(open.pick).toEqual(prev.card.pick)
      // On its due tick (a days-0 link the tick after; a payday tick waits one more).
      const due = Math.max(link!.dueTick, prev.tick + 1)
      expect(open.openedTick).toBeGreaterThanOrEqual(due)
      expect(open.openedTick).toBeLessThanOrEqual(due + 1)
    }
    prev = decide(sim, m.card, m.choose, log)
    m.check?.(sim, prev, log)
  }
  const last = prev!
  const ev = sim.state.events
  const chain = story.moves.length > 1 || story.drop !== undefined
  expect(ev.stats.chainsStarted, `${story.name}: chainsStarted`).toBe(
    stats0.chainsStarted + (chain ? 1 : 0),
  )
  if (story.drop) {
    expect(last.booked).toHaveLength(1)
    story.drop(sim)
    const offered = collect(sim, 'event:offered')
    expect(runUntil(sim, () => sim.state.events.open !== null, LINK_WAIT)).toBe(
      -1,
    )
    expect(offered).toEqual([])
    expect(ev.scheduled).toEqual([])
    expect(
      ev.stats.chainsFinished,
      `${story.name}: a dropped link ends nothing`,
    ).toBe(stats0.chainsFinished)
  } else {
    expect(last.booked, `${story.name}: the last answer books nothing`).toEqual(
      [],
    )
    expect(ev.scheduled).toEqual([])
    expect(ev.stats.chainsFinished, `${story.name}: chainsFinished`).toBe(
      stats0.chainsFinished + (chain ? 1 : 0),
    )
    if (chain) {
      const title = fillCardText(sim.data, headDef.title, last.card)
      expect(news.map((n) => n.text)).toContain(
        sim.data.puns.tickerEvent.chainDone.replaceAll('{title}', title),
      )
    }
  }
  expect(auditState(sim.state, sim.data), `${story.name}: auditState`).toEqual(
    [],
  )
  return sim
}

// Setup helpers -----------------------------------------------------------------------

const withBikeAndVan = (sim: Sim): void => {
  buy(sim, 'bike')
  buy(sim, 'van')
  fund(sim, FUNDS)
}
const withVan = (sim: Sim): void => {
  buy(sim, 'van')
  fund(sim, FUNDS)
}
const withBike = (sim: Sim): void => {
  buy(sim, 'bike')
  fund(sim, FUNDS)
}
const withTruck = (sim: Sim): void => {
  buy(sim, 'truck')
  fund(sim, FUNDS)
}
/** Two seated inspectors with charisma to lose (the union's long memories show). */
const twoInspectors = (sim: Sim): void => {
  hireInspector(sim, { eye: 3, pace: 3, charisma: 2 })
  for (const e of sim.state.employees)
    if (e.role === 'inspector') e.pips.charisma = 2
  resyncDesks(sim)
  fund(sim, FUNDS)
}
const docksLive = (sim: Sim): void => unlockDistrict(sim, 'docks')
/** One district unhappy enough to petition (the lowest, under the head's satBelow). */
const unhappyDistrict = (sim: Sim): void => {
  const below = cardDef('ev_cust_petition').cond?.satBelow?.value ?? 45
  const d = liveSpawningDistricts(sim)[0]!
  sim.state.districts[d]!.satisfaction = below - 15
}
const shelfOf =
  (n: number) =>
  (sim: Sim): void => {
    for (let i = 0; i < n; i++)
      shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
  }

const noSpeedRow = (sim: Sim): void => {
  expect(sim.state.modifiers.filter((m) => m.key === 'speed')).toEqual([])
  expect(modMult(sim, 'speed', 'bike')).toBe(1)
}

// The stories -------------------------------------------------------------------------

const GANG = 'ev_crime_gang'
const WATCH = 'ev_crime_gang_watch'
const RETURN = 'ev_crime_gang_return'
const BUST = 'ev_crime_gang_bust'

const STORIES: Story[] = [
  // Underworld — the gang (4 cards).
  {
    name: 'gang: Refuse → watch: Carry on → a bike lost → the price went up → the police → the raid (wanted, a life back)',
    level: 2,
    setup: withBikeAndVan,
    moves: [
      { card: GANG, choose: books(WATCH) },
      {
        card: WATCH,
        choose: losesVehicle('bike'),
        check: (sim, step, log) => {
          const lostEv = log.find(
            (x) => x.name === 'vehicle:lost' && x.tick === step.tick,
          )
          expect(lostEv?.p).toMatchObject({
            type: 'bike',
            eventId: WATCH,
            last: false,
          })
          expect(sim.state.vehicles.map((v) => v.type)).toEqual(['van'])
        },
      },
      { card: RETURN, choose: books(BUST) },
      {
        card: BUST,
        choose: only,
        check: (sim, _step, log) => {
          expect(sim.state.wanted.length).toBeGreaterThan(0)
          expect(log.some((x) => x.name === 'life:gained')).toBe(true)
        },
      },
    ],
  },
  {
    name: 'gang: Refuse → watch: Hide the fleet (a slow day that expires) → the price went up → pay',
    level: 2,
    setup: withBikeAndVan,
    moves: [
      { card: GANG, choose: books(WATCH) },
      { card: WATCH, choose: mod('speed') },
      {
        card: RETURN,
        choose: and(setsFlag('gang_paid'), paid),
        before: (sim) =>
          expect(sim.state.modifiers.map((m) => m.key)).toEqual(['speed']),
        check: noSpeedRow,
      },
    ],
  },
  {
    name: 'gang: no bike to lose — the watch takes its fallback money instead',
    level: 2,
    setup: withVan,
    moves: [
      { card: GANG, choose: books(WATCH) },
      {
        card: WATCH,
        choose: losesVehicle('bike'),
        check: (sim) =>
          expect(sim.state.vehicles.map((v) => v.type)).toEqual(['van']),
      },
      { card: RETURN, choose: and(setsFlag('gang_paid'), paid) },
    ],
  },
  {
    name: 'gang: pay at the door',
    level: 2,
    moves: [{ card: GANG, choose: and(setsFlag('gang_paid'), paid) }],
  },

  // Staff — the union (4 cards) and the intern pair.
  {
    name: 'union: Refuse → work to rule (Hold firm: the desk slows) → strike (Wait it out: the desk empty) → long memories',
    level: 3,
    setup: twoInspectors,
    moves: [
      { card: 'ev_staff_union_ask', choose: books('ev_staff_union_slow') },
      {
        card: 'ev_staff_union_slow',
        choose: books('ev_staff_union_strike'),
        check: (sim) =>
          expect(modMult(sim, 'processS', 'desk')).toBeGreaterThan(1),
      },
      {
        card: 'ev_staff_union_strike',
        choose: books('ev_staff_union_end'),
        check: (sim) => {
          const desks = sim.state.lane.nodes.filter(
            (n) => n.fixture?.kind === 'desk',
          )
          expect(
            desks.every((n) => n.stations.length === 0),
            'every desk empty',
          ).toBe(true)
        },
      },
      {
        card: 'ev_staff_union_end',
        choose: only,
        check: (sim) => {
          // Back from the strike when the last card opens (the absence was one day).
          const inspectors = sim.state.employees.filter(
            (e) => e.role === 'inspector',
          )
          expect(inspectors.every((e) => e.absentUntilTick === undefined)).toBe(
            true,
          )
          const desks = sim.state.lane.nodes.filter(
            (n) => n.fixture?.kind === 'desk',
          )
          expect(desks.some((n) => n.stations.length > 0)).toBe(true)
          expect(inspectors.every((e) => e.pips.charisma === 1)).toBe(true)
        },
      },
    ],
  },
  {
    name: 'union: Grant it (the raise for good, a sharper desk)',
    level: 3,
    setup: twoInspectors,
    moves: [{ card: 'ev_staff_union_ask', choose: noLink }],
  },
  {
    name: 'union: Refuse → work to rule → Offer 8 %',
    level: 3,
    setup: twoInspectors,
    moves: [
      { card: 'ev_staff_union_ask', choose: books('ev_staff_union_slow') },
      { card: 'ev_staff_union_slow', choose: noLink },
    ],
  },
  {
    name: 'union: Refuse → Hold firm → strike → Hire temps (nobody away)',
    level: 3,
    setup: twoInspectors,
    moves: [
      { card: 'ev_staff_union_ask', choose: books('ev_staff_union_slow') },
      { card: 'ev_staff_union_slow', choose: books('ev_staff_union_strike') },
      {
        card: 'ev_staff_union_strike',
        choose: and(paid, noLink),
        check: (sim) =>
          expect(
            sim.state.employees.every((e) => e.absentUntilTick === undefined),
          ).toBe(true),
      },
    ],
  },
  {
    name: 'intern: Take them on → sharp eyes → Offer a job (★ in the pool)',
    level: 1,
    moves: [
      { card: 'ev_staff_intern', choose: books('ev_staff_intern_grows') },
      {
        card: 'ev_staff_intern_grows',
        choose: has('staff', (e) => 'star' in e),
      },
    ],
  },
  {
    name: 'intern: Take them on → sharp eyes → Keep their notes (a wanted label)',
    level: 1,
    moves: [
      { card: 'ev_staff_intern', choose: books('ev_staff_intern_grows') },
      { card: 'ev_staff_intern_grows', choose: has('wanted') },
    ],
  },
  {
    name: 'intern: Decline',
    level: 1,
    moves: [{ card: 'ev_staff_intern', choose: nothing }],
  },

  // Fleet — the gearbox pair.
  {
    name: 'gearbox: Run it → dead on the hill → Scrap it (the truck gone, money back)',
    level: 2,
    setup: withTruck,
    moves: [
      { card: 'ev_fleet_gearbox', choose: books('ev_fleet_gearbox_dead') },
      {
        card: 'ev_fleet_gearbox_dead',
        choose: losesVehicle('truck'),
        check: (sim) => expect(sim.state.vehicles).toEqual([]),
      },
    ],
  },
  {
    name: 'gearbox: Run it → dead on the hill → Tow and fix',
    level: 2,
    setup: withTruck,
    moves: [
      { card: 'ev_fleet_gearbox', choose: books('ev_fleet_gearbox_dead') },
      { card: 'ev_fleet_gearbox_dead', choose: paid },
    ],
  },
  {
    name: 'gearbox: Fix it now',
    level: 2,
    setup: withTruck,
    moves: [{ card: 'ev_fleet_gearbox', choose: paid }],
  },
  {
    name: 'gearbox: Run it, short of the tow when it dies → dropped (the truck limps on)',
    level: 2,
    setup: withTruck,
    moves: [
      { card: 'ev_fleet_gearbox', choose: books('ev_fleet_gearbox_dead') },
    ],
    drop: brokeBelow(balanceAtLeastOf('ev_fleet_gearbox_dead')),
  },

  // Customers — the rival (5 cards) and the VIP trio.
  {
    name: 'rival: Price war → poach (Pay a bonus) → trouble (Wait) → folds (their calls) → the auction (Bid): five cards',
    level: 2,
    setup: withBike,
    moves: [
      {
        card: 'ev_cust_rival_opens',
        choose: and(books('ev_cust_rival_poach'), paid),
      },
      {
        card: 'ev_cust_rival_poach',
        choose: and(books('ev_cust_rival_trouble'), paid),
        check: (sim, step) =>
          expect(
            sim.state.employees.some((e) => e.id === step.card.pick?.id),
          ).toBe(true),
      },
      { card: 'ev_cust_rival_trouble', choose: books('ev_cust_rival_folds') },
      {
        card: 'ev_cust_rival_folds',
        choose: books('ev_cust_rival_auction'),
        check: (sim) =>
          expect(modMult(sim, 'spawn', 'highres')).toBeLessThan(1),
      },
      { card: 'ev_cust_rival_auction', choose: gainsVehicle },
    ],
  },
  {
    name: 'rival: Ignore → poach (Let them go: the driver quits) → trouble (Buy them: their van)',
    level: 2,
    setup: withBike,
    moves: [
      {
        card: 'ev_cust_rival_opens',
        choose: and(books('ev_cust_rival_poach'), free),
      },
      {
        card: 'ev_cust_rival_poach',
        choose: has('staff', (e) => 'quit' in e),
        check: (sim) => expect(sim.state.vehicles[0]?.driverId).toBeNull(),
      },
      { card: 'ev_cust_rival_trouble', choose: gainsVehicle },
    ],
  },
  {
    name: 'rival: … trouble → Wait → folds → the auction: Pass',
    level: 2,
    setup: withBike,
    moves: [
      {
        card: 'ev_cust_rival_opens',
        choose: and(books('ev_cust_rival_poach'), free),
      },
      {
        card: 'ev_cust_rival_poach',
        choose: and(books('ev_cust_rival_trouble'), paid),
      },
      { card: 'ev_cust_rival_trouble', choose: books('ev_cust_rival_folds') },
      { card: 'ev_cust_rival_folds', choose: books('ev_cust_rival_auction') },
      { card: 'ev_cust_rival_auction', choose: nothing },
    ],
  },
  {
    name: 'rival: the poach needs $ when due — short of it, it never comes',
    level: 2,
    setup: withBike,
    moves: [
      {
        card: 'ev_cust_rival_opens',
        choose: and(books('ev_cust_rival_poach'), free),
      },
    ],
    drop: brokeBelow(balanceAtLeastOf('ev_cust_rival_poach')),
  },
  {
    name: 'VIP: Promise it → delighted (its district happy when due)',
    level: 1,
    moves: [
      { card: 'ev_cust_vip', choose: books('ev_cust_vip_glad') },
      { card: 'ev_cust_vip_glad', choose: only, before: setTargetSat(80) },
    ],
  },
  {
    name: 'VIP: Promise it → furious (its district unhappy when due)',
    level: 1,
    moves: [
      { card: 'ev_cust_vip', choose: books('ev_cust_vip_glad') },
      { card: 'ev_cust_vip_mad', choose: only, before: setTargetSat(20) },
    ],
  },
  {
    name: 'VIP: Decline',
    level: 1,
    moves: [{ card: 'ev_cust_vip', choose: nothing }],
  },
  {
    name: 'petition: Ignore it → the hearing (its own story) → fined (an unhappy town)',
    level: 2,
    setup: unhappyDistrict,
    moves: [
      { card: 'ev_cust_petition', choose: books('ev_city_hearing') },
      { card: 'ev_city_hearing', choose: only },
      { card: 'ev_city_hearing_lost', choose: only, before: setSat(20) },
    ],
  },
  {
    name: 'petition: Apologise publicly',
    level: 2,
    setup: unhappyDistrict,
    moves: [{ card: 'ev_cust_petition', choose: paid }],
  },

  // Security — the ring (router), the crate, the record → the front page.
  {
    name: 'ring: Investigate (the inspector away a day) → caught (names them; the ring on the wanted list)',
    level: 3,
    setup: withTruck,
    moves: [
      { card: 'ev_sec_breach', choose: setsFlag('leak_found') },
      {
        card: 'ev_sec_breach_caught',
        choose: only,
        check: (_sim, step) => {
          const body = fillCardText(
            data,
            cardDef('ev_sec_breach_caught').body!,
            step.card,
          )
          expect(step.card.pick?.role).toBe('inspector')
          expect(body).toContain(step.card.pick!.name)
        },
      },
    ],
  },
  {
    name: 'ring: Ignore → the registry acts → Pay the fine',
    level: 3,
    setup: withTruck,
    moves: [
      { card: 'ev_sec_breach', choose: and(books('ev_sec_breach_day'), free) },
      { card: 'ev_sec_breach_strike', choose: paid },
    ],
  },
  {
    name: 'ring: Ignore → the registry acts → Take the strike (a life)',
    level: 3,
    setup: withTruck,
    moves: [
      { card: 'ev_sec_breach', choose: and(books('ev_sec_breach_day'), free) },
      { card: 'ev_sec_breach_strike', choose: losesLife },
    ],
  },
  {
    name: 'ring: Ignore, short of the fine when the registry calls → dropped',
    level: 3,
    setup: withTruck,
    moves: [
      { card: 'ev_sec_breach', choose: and(books('ev_sec_breach_day'), free) },
    ],
    drop: brokeBelow(balanceAtLeastOf('ev_sec_breach_strike')),
  },
  {
    name: 'crate: Open it → inside (at once) → Keep the scanners (a life for the machines)',
    level: 2,
    moves: [
      { card: 'ev_sec_crate', choose: books('ev_sec_crate_open') },
      { card: 'ev_sec_crate_open', choose: losesLife },
    ],
  },
  {
    name: 'crate: Open it → Burn the lot',
    level: 2,
    moves: [
      { card: 'ev_sec_crate', choose: books('ev_sec_crate_open') },
      { card: 'ev_sec_crate_open', choose: nothing },
    ],
  },
  {
    name: 'crate: Hold it → a nervous man → Hand it over',
    level: 2,
    moves: [
      { card: 'ev_sec_crate', choose: books('ev_sec_crate_owner') },
      { card: 'ev_sec_crate_owner', choose: has('money') },
    ],
  },
  {
    name: 'crate: Hold it → a nervous man → Call the police',
    level: 2,
    moves: [
      { card: 'ev_sec_crate', choose: books('ev_sec_crate_owner') },
      { card: 'ev_sec_crate_owner', choose: has('wanted') },
    ],
  },
  {
    name: 'crate: Toss it',
    level: 2,
    moves: [{ card: 'ev_sec_crate', choose: and(noLink, has('money')) }],
  },
  {
    name: 'the record: Stonewall → the front page → Sue',
    level: 3,
    moves: [
      { card: 'ev_sec_leak', choose: books('ev_press_expose') },
      { card: 'ev_press_expose', choose: has('money') },
    ],
  },
  {
    name: 'the record: Stonewall → the front page → Apologise',
    level: 3,
    moves: [
      { card: 'ev_sec_leak', choose: books('ev_press_expose') },
      { card: 'ev_press_expose', choose: not(has('money')) },
    ],
  },
  {
    name: 'the record: Be honest',
    level: 3,
    moves: [{ card: 'ev_sec_leak', choose: noLink }],
  },

  // Money — the investor (4 cards) and the tax pair.
  {
    name: 'investor: Take it → a say in hiring (Refuse) → buy them out? (Wait) → cashing out: the cut ends',
    level: 2,
    moves: [
      {
        card: 'ev_money_investor',
        choose: books('ev_money_investor_board'),
        check: (sim) => expect(modMult(sim, 'income')).toBeLessThan(1),
      },
      {
        card: 'ev_money_investor_board',
        choose: books('ev_money_investor_buyout'),
      },
      {
        card: 'ev_money_investor_buyout',
        choose: books('ev_money_investor_exit'),
      },
      {
        card: 'ev_money_investor_exit',
        choose: only,
        check: (sim) => expect(modMult(sim, 'income')).toBe(1),
      },
    ],
  },
  {
    name: 'investor: Take it → a say in hiring: Agree (lower wages, less training; the cut stays)',
    level: 2,
    moves: [
      { card: 'ev_money_investor', choose: books('ev_money_investor_board') },
      {
        card: 'ev_money_investor_board',
        choose: has('pips'),
        check: (sim) => expect(modMult(sim, 'income')).toBeLessThan(1),
      },
    ],
  },
  {
    name: 'investor: Take it → Refuse → Buy out (the cut ends)',
    level: 2,
    moves: [
      { card: 'ev_money_investor', choose: books('ev_money_investor_board') },
      {
        card: 'ev_money_investor_board',
        choose: books('ev_money_investor_buyout'),
      },
      {
        card: 'ev_money_investor_buyout',
        choose: and(has('end'), paid),
        check: (sim) => expect(modMult(sim, 'income')).toBe(1),
      },
    ],
  },
  {
    name: 'investor: Decline',
    level: 2,
    moves: [{ card: 'ev_money_investor', choose: nothing }],
  },
  {
    name: 'tax: Defer → the late fee (a bigger cut of the balance)',
    level: 3,
    moves: [
      { card: 'ev_money_tax', choose: books('ev_money_tax_late') },
      { card: 'ev_money_tax_late', choose: only },
    ],
  },
  {
    name: 'tax: Pay',
    level: 3,
    moves: [{ card: 'ev_money_tax', choose: has('moneyPct') }],
  },

  // City hall — the permit hearing (conditional), the audit (router + conditional), the award trio.
  {
    name: 'permit: Contest → the hearing → case dismissed (the average happy when it rules)',
    level: 2,
    moves: [
      { card: 'ev_city_permit', choose: books('ev_city_hearing') },
      { card: 'ev_city_hearing', choose: only },
      { card: 'ev_city_hearing_won', choose: only, before: setSat(80) },
    ],
  },
  {
    name: 'permit: Contest → the hearing → fined (the average unhappy when it rules)',
    level: 2,
    moves: [
      { card: 'ev_city_permit', choose: books('ev_city_hearing') },
      { card: 'ev_city_hearing', choose: only },
      { card: 'ev_city_hearing_lost', choose: only, before: setSat(20) },
    ],
  },
  {
    name: 'permit: Pay',
    level: 2,
    moves: [{ card: 'ev_city_permit', choose: paid }],
  },
  {
    name: 'audit: the consultant → audit day passes on the flag (the lane still under 95 %)',
    level: 2,
    moves: [
      { card: 'ev_city_audit', choose: setsFlag('audit_ready') },
      { card: 'ev_city_audit_pass', choose: only, before: laneUnder },
    ],
  },
  {
    name: 'audit: Wing it, the lane at 95 %+ by audit day → passed',
    level: 2,
    moves: [
      { card: 'ev_city_audit', choose: and(books('ev_city_audit_day'), free) },
      { card: 'ev_city_audit_pass', choose: only, before: fixLane },
    ],
  },
  {
    name: 'audit: Wing it under 95 % → failed → Fix it first, fixed in time → passed',
    level: 2,
    moves: [
      { card: 'ev_city_audit', choose: and(books('ev_city_audit_day'), free) },
      {
        card: 'ev_city_audit_fail',
        choose: books('ev_city_audit_pass'),
        before: laneUnder,
      },
      { card: 'ev_city_audit_pass', choose: only, before: fixLane },
    ],
  },
  {
    name: 'audit: … failed → Fix it first, still under → the steeper fine → Take the strike (a life)',
    level: 2,
    moves: [
      { card: 'ev_city_audit', choose: and(books('ev_city_audit_day'), free) },
      { card: 'ev_city_audit_fail', choose: books('ev_city_audit_fine') },
      { card: 'ev_city_audit_fine', choose: losesLife, before: laneUnder },
    ],
  },
  {
    name: 'audit: … failed → Fix it first, still under → the steeper fine → Pay',
    level: 2,
    moves: [
      { card: 'ev_city_audit', choose: and(books('ev_city_audit_day'), free) },
      { card: 'ev_city_audit_fail', choose: books('ev_city_audit_fine') },
      { card: 'ev_city_audit_fine', choose: paid },
    ],
  },
  {
    name: 'audit: … failed → Pay the fine',
    level: 2,
    moves: [
      { card: 'ev_city_audit', choose: and(books('ev_city_audit_day'), free) },
      { card: 'ev_city_audit_fail', choose: and(paid, noLink) },
    ],
  },
  {
    name: 'audit: … failed → Fix it first, still under and short of the steeper fine → dropped',
    level: 2,
    moves: [
      { card: 'ev_city_audit', choose: and(books('ev_city_audit_day'), free) },
      { card: 'ev_city_audit_fail', choose: books('ev_city_audit_fine') },
    ],
    drop: brokeBelow(balanceAtLeastOf('ev_city_audit_fine')),
  },
  {
    name: 'award: Apply → the winner (the average happy when due; a life back)',
    level: 3,
    moves: [
      { card: 'ev_city_award', choose: books('ev_city_award_won') },
      { card: 'ev_city_award_won', choose: only, before: setSat(80) },
    ],
  },
  {
    name: 'award: Apply → runner-up (the average unhappy when due)',
    level: 3,
    moves: [
      { card: 'ev_city_award', choose: books('ev_city_award_won') },
      { card: 'ev_city_award_lost', choose: only, before: setSat(20) },
    ],
  },
  {
    name: 'award: Skip',
    level: 3,
    moves: [{ card: 'ev_city_award', choose: nothing }],
  },

  // Weather — the storm (router on a flag).
  {
    name: 'storm: Board up → it held (the flag cleared)',
    level: 1,
    moves: [
      { card: 'ev_wx_storm', choose: setsFlag('prepared') },
      { card: 'ev_wx_storm_held', choose: only },
    ],
  },
  {
    name: 'storm: Ignore → damage → Do it yourselves (a slow day, shelf parcels lost)',
    level: 1,
    setup: shelfOf(5),
    moves: [
      { card: 'ev_wx_storm', choose: and(books('ev_wx_storm_hits'), free) },
      { card: 'ev_wx_storm_damage', choose: has('parcels') },
    ],
  },
  {
    name: 'storm: Ignore → damage → Pay a crew',
    level: 1,
    moves: [
      { card: 'ev_wx_storm', choose: and(books('ev_wx_storm_hits'), free) },
      { card: 'ev_wx_storm_damage', choose: paid },
    ],
  },

  // Press — the review trio, the influencer (router on its district).
  {
    name: 'review: Invite them → five stars (the average happy tomorrow)',
    level: 1,
    moves: [
      { card: 'ev_press_review', choose: books('ev_press_review_good') },
      { card: 'ev_press_review_good', choose: only, before: setSat(80) },
    ],
  },
  {
    name: 'review: Invite them → two stars (the average unhappy tomorrow)',
    level: 1,
    moves: [
      { card: 'ev_press_review', choose: books('ev_press_review_good') },
      { card: 'ev_press_review_bad', choose: only, before: setSat(20) },
    ],
  },
  {
    name: 'review: Decline',
    level: 1,
    moves: [{ card: 'ev_press_review', choose: nothing }],
  },
  {
    name: 'influencer: Do it → glowing (its district happy when the video lands) → Bring it on',
    level: 1,
    moves: [
      { card: 'ev_press_influencer', choose: books('ev_press_video') },
      {
        card: 'ev_press_video_glow',
        choose: mod('spawn'),
        before: setTargetSat(80),
      },
    ],
  },
  {
    name: 'influencer: Do it → glowing → No interviews',
    level: 1,
    moves: [
      { card: 'ev_press_influencer', choose: books('ev_press_video') },
      {
        card: 'ev_press_video_glow',
        choose: not(mod('spawn')),
        before: setTargetSat(80),
      },
    ],
  },
  {
    name: 'influencer: Do it → a roast (its district unhappy when the video lands)',
    level: 1,
    moves: [
      { card: 'ev_press_influencer', choose: books('ev_press_video') },
      { card: 'ev_press_video_roast', choose: only, before: setTargetSat(20) },
    ],
  },
  {
    name: 'influencer: No',
    level: 1,
    moves: [{ card: 'ev_press_influencer', choose: nothing }],
  },

  // Underworld — the fence pair.
  {
    name: 'fence: Take the deal (scanners cheap for a day) → traced → Cooperate',
    level: 2,
    moves: [
      { card: 'ev_crime_fence', choose: books('ev_crime_fence_police') },
      {
        card: 'ev_crime_fence_police',
        choose: paid,
        before: (sim) => expect(modMult(sim, 'machinePrice')).toBeLessThan(1),
        check: (sim) => expect(modMult(sim, 'machinePrice')).toBe(1),
      },
    ],
  },
  {
    name: 'fence: Take the deal → traced → Deny everything',
    level: 2,
    moves: [
      { card: 'ev_crime_fence', choose: books('ev_crime_fence_police') },
      { card: 'ev_crime_fence_police', choose: free },
    ],
  },
  {
    name: 'fence: Walk away',
    level: 2,
    moves: [{ card: 'ev_crime_fence', choose: nothing }],
  },

  // Port — the spot check (conditional, at once), the dockers' strike (3 cards).
  {
    name: 'spot check: Show them → spotless (the lane at 95 %+ when they look)',
    level: 3,
    setup: docksLive,
    moves: [
      { card: 'ev_port_spotcheck', choose: books('ev_port_spotcheck_ok') },
      { card: 'ev_port_spotcheck_ok', choose: only, before: fixLane },
    ],
  },
  {
    name: 'spot check: Show them → gaps (customs slows the docks)',
    level: 3,
    setup: docksLive,
    moves: [
      { card: 'ev_port_spotcheck', choose: books('ev_port_spotcheck_ok') },
      {
        card: 'ev_port_spotcheck_slow',
        choose: only,
        before: laneUnder,
        check: (sim) =>
          expect(modMult(sim, 'clearanceS', 'docks')).toBeGreaterThan(1),
      },
    ],
  },
  {
    name: 'spot check: Stall them',
    level: 3,
    setup: docksLive,
    moves: [{ card: 'ev_port_spotcheck', choose: noLink }],
  },
  {
    name: 'dockers: Oppose → strike (the docks crawl a day) → settlement: Refuse',
    level: 3,
    setup: docksLive,
    moves: [
      { card: 'ev_port_strike', choose: books('ev_port_strike_on') },
      { card: 'ev_port_strike_on', choose: only },
      {
        card: 'ev_port_strike_end',
        choose: free,
        before: (sim) =>
          expect(modMult(sim, 'clearanceS', 'docks')).toBeGreaterThan(1),
      },
    ],
  },
  {
    name: 'dockers: Oppose → strike → settlement: Settle',
    level: 3,
    setup: docksLive,
    moves: [
      { card: 'ev_port_strike', choose: books('ev_port_strike_on') },
      { card: 'ev_port_strike_on', choose: only },
      { card: 'ev_port_strike_end', choose: paid },
    ],
  },
  {
    name: 'dockers: Support them',
    level: 3,
    setup: docksLive,
    moves: [{ card: 'ev_port_strike', choose: noLink }],
  },
]

describe('the shipped stories, card by card through decideEvent (plan-build3 §8.4 task 4)', () => {
  for (const story of STORIES) {
    it(story.name, () => {
      runStory(story)
    })
  }

  it('gang: the watch takes your last bike with the till short of another → the loaner (the rescue) arrives before the gang returns', () => {
    const sim = playing(2, 2)
    buy(sim, 'bike')
    // The rescue needs the deck on; no draw comes before the far timer.
    sim.state.events.nextDrawTick = 1e11
    const log = eventLog(sim)
    expect(sim.dispatch({ kind: 'debugOfferEvent', eventId: GANG })).toEqual({
      ok: true,
    })
    decide(sim, GANG, books(WATCH), log)
    runUntil(sim, () => sim.state.events.open !== null, LINK_WAIT)
    const bike = data.vehicles.types.find((t) => t.id === 'bike')!
    sim.state.economy.balance = bike.price - 1
    const step = decide(sim, WATCH, losesVehicle('bike'), log)
    expect(log.find((x) => x.name === 'vehicle:lost')?.p).toMatchObject({
      last: true,
    })
    expect(sim.state.vehicles).toEqual([])
    const rescueAt = step.tick + ticksFromS(data.events.schedule.rescueDelayS)
    runUntil(sim, () => sim.state.events.open !== null, LINK_WAIT)
    const loaner = sim.state.events.open!
    expect(cardDef(loaner.eventId).rescue).toBe(true)
    expect(loaner).toMatchObject({ depth: 1, drawn: false })
    expect(loaner.openedTick).toBeGreaterThanOrEqual(rescueAt)
    expect(loaner.openedTick).toBeLessThan(step.booked[0]!.dueTick)
    decide(sim, loaner.eventId, only, log)
    expect(sim.state.vehicles.map((v) => v.type)).toEqual(['bike'])
    // The gang comes back on its own day all the same; the paid answer is greyed, the police are not.
    runUntil(sim, () => sim.state.events.open !== null, LINK_WAIT)
    expect(sim.state.events.open?.eventId).toBe(RETURN)
    const opts = cardOptions(sim, sim.state.events.open!)
    expect(opts[optionIndex(RETURN, paid)]!.affordable).toBe(false)
    decide(sim, RETURN, books(BUST), log)
    runUntil(sim, () => sim.state.events.open !== null, LINK_WAIT)
    decide(sim, BUST, only, log)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })
})

// Coverage: computed from the shipped deck, so a card added in a pass shows here.

/** A card's direct children (next ids, branch ids; a router's branches). */
function children(d: EventDef): string[] {
  const out: string[] = []
  for (const b of d.next?.branches ?? []) out.push(b.id)
  for (const o of d.options ?? [])
    for (const e of o.effects)
      if (e.kind === 'next') {
        if ('branches' in e) out.push(...e.branches.map((b) => b.id))
        else out.push(e.eventId)
      }
  return out
}

/** The cards a story reaches from `head` (routers included). */
function reach(head: string): Set<string> {
  const seen = new Set<string>()
  const stack = [head]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...children(cardDef(id)))
  }
  return seen
}

/** The most cards a player sees on one path from `id` (routers are not shown). */
function longest(id: string): number {
  const d = cardDef(id)
  const below = Math.max(0, ...children(d).map(longest))
  return (d.router ? 0 : 1) + below
}

const heads = deck.filter(
  (d) =>
    d.drawable !== false && !d.router && !d.rescue && children(d).length > 0,
)

describe('coverage: every story of the shipped deck is played', () => {
  it('every chain head starts a story here; every link and branch card is opened by one', () => {
    const played = new Set(STORIES.map((s) => s.moves[0]!.card))
    expect(heads.map((h) => h.id).filter((h) => !played.has(h))).toEqual([])
    const opened = new Set(STORIES.flatMap((s) => s.moves.map((m) => m.card)))
    const links = new Set(
      heads
        .flatMap((h) => [...reach(h.id)])
        .filter((id) => !cardDef(id).router),
    )
    expect([...links].filter((id) => !opened.has(id))).toEqual([])
  })

  it('every answer of every chain card is played by some story', () => {
    const chosen = new Map<string, Set<number>>()
    for (const s of STORIES)
      for (const m of s.moves) {
        const set = chosen.get(m.card) ?? new Set<number>()
        set.add(optionIndex(m.card, m.choose))
        chosen.set(m.card, set)
      }
    const missing: string[] = []
    for (const h of heads)
      for (const id of reach(h.id)) {
        const d = cardDef(id)
        ;(d.options ?? []).forEach((o, i) => {
          if (!chosen.get(id)?.has(i)) missing.push(`${id} "${o.label}"`)
        })
      }
    expect(missing).toEqual([])
  })

  it('each head’s longest story (the 4–5-card ones above all) is played end to end', () => {
    const short: string[] = []
    for (const h of heads) {
      const want = longest(h.id)
      const got = Math.max(
        ...STORIES.filter((s) => s.moves[0]!.card === h.id).map(
          (s) => s.moves.length,
        ),
      )
      if (got < want) short.push(`${h.id}: ${got} of ${want} cards`)
    }
    expect(short).toEqual([])
    // The plan's stories of 4–5 cards ship (B3 §4: the gang, the union, the rival, the investor).
    const long = heads.filter((h) => longest(h.id) >= 4).map((h) => h.id)
    expect(long).toEqual(
      expect.arrayContaining([
        'ev_crime_gang',
        'ev_staff_union_ask',
        'ev_cust_rival_opens',
        'ev_money_investor',
      ]),
    )
  })

  it('every conditional next and router is played both ways (each branch card opened)', () => {
    const opened = new Set(STORIES.flatMap((s) => s.moves.map((m) => m.card)))
    const branchCards = new Set<string>()
    for (const d of deck) {
      for (const b of d.next?.branches ?? []) branchCards.add(b.id)
      for (const o of d.options ?? [])
        for (const e of o.effects)
          if (e.kind === 'next' && 'branches' in e)
            for (const b of e.branches) branchCards.add(b.id)
    }
    expect(branchCards.size).toBeGreaterThan(0)
    expect([...branchCards].filter((id) => !opened.has(id))).toEqual([])
  })
})
