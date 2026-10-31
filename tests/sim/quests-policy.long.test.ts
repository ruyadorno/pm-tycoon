// spec-build2 §7.2 "quests" row, §7.3; plan-build2 §8.4 tasks 5 + 7 and its
// acceptance; design-m7 §5.1-§5.2, §7: the policy's quest rule —
// questPolicyStep, called once from CompetentPolicy.step() for both kinds —
// accepts every offer on the step it appears (the Golden Release as soon as
// no quest is active) and rushes the golden parcel's origin on its spawn tick
// (the accept spawns it, so accept and rush land in the same step); it never
// declines, abandons or rushes the destination. Over seeds 1-10 × 30 min the
// gate's quest rows pass by median (questsOffered30 ≥ 4, questsCompleted30
// ≥ 2), the plan's "a quest active between minutes 7 and 13 on ≥ 8/10 seeds"
// and the per-template offered / completed / failed counts are printed
// (informational, the R-reach check of design §9), and the playtest-1 rows
// still pass on these runs (vitest files share no cache, so this file runs
// its own). Tagged [long]: excluded from `vlr check:quick` like
// policy.test.ts (tools/check.mjs), run by the full `vlr check`.
//
// Build 3, M11 (spec-build3 §3.1, §3.8; M11 contract §1 "Jobs", §3 stream
// D task 4): regular quests arrive as job cards drawn by the deck; the
// competent policy answers them first in its step (eventPolicyStep: Accept
// always outscores Decline, D-37) through decideEvent, so the quest goes
// offered → active on the step after the tick that drew the card, and a
// magic parcel's accept and its origin rush still land in one step.
// questPolicyStep itself accepts only the Golden Release (no card holds
// it). acceptQuest never appears in the policy's log for a regular quest.

import { describe, expect, it } from 'vitest'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import { createPolicy, questPolicyStep } from '../../src/sim/policy.ts'
import { JOB_ACCEPT } from '../../src/sim/systems/deck.ts'
import { isRushed } from '../../src/sim/systems/dispatch.ts'
import { TICKS_PER_DAY, ticksFromS } from '../../src/sim/types.ts'
import { runSeed } from '../../tools/sim/cli.ts'
import type { RunResult } from '../../tools/sim/cli.ts'
import {
  median,
  QUEST_PLATEAU,
  questTallies,
  summarise,
  tallyText,
} from '../../tools/sim/report.ts'
import {
  dataFixture,
  deckOn,
  makeSim,
  noOffers,
  offerQuest,
  quietSim,
  runTicks,
  startQuest,
  withDecisions,
} from './helpers.ts'

const data = dataFixture()
const targets = data.economy.pacingTargets
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

let gateRuns: RunResult[] | null = null
/** The 10-seed × 30-min competent-policy runs (computed once for this file). */
function runs(): RunResult[] {
  // Pass 1 (B3 §2.3): the decision draw off until M14's pass 2 (M12).
  gateRuns ??= withDecisions(false, () =>
    SEEDS.map((seed) => runSeed(data, seed, 30, createPolicy)),
  )
  return gateRuns
}

const kinds = (sim: ReturnType<typeof makeSim>, from: number): string[] =>
  sim.commandLog.slice(from).map((e) => e.cmd.kind)

describe('questPolicyStep (B2 §7.2 quests row; design §5.1)', () => {
  it('the first job card (a deck draw, never before firstEventS) is accepted through decideEvent on the policy step after the tick that drew it — the same sim tick', () => {
    const sim = deckOn(makeSim(2))
    const policy = createPolicy(sim, 'competent')
    while (sim.state.events.open?.kind !== 'job') {
      policy.step()
      sim.tick()
    }
    const card = sim.state.events.open
    const offer = sim.state.quests.offer!
    expect(card.questId).toBe(offer.id)
    expect(card.openedTick).toBe(sim.state.tick)
    expect(offer.offeredTick).toBe(sim.state.tick)
    expect(offer.offeredTick).toBeGreaterThanOrEqual(
      ticksFromS(data.events.schedule.firstEventS),
    )
    const n = sim.commandLog.length
    policy.step()
    const cmds = sim.commandLog.slice(n)
    expect(cmds[0]).toMatchObject({
      tick: offer.offeredTick,
      cmd: { kind: 'decideEvent', eventId: card.eventId, option: JOB_ACCEPT },
    })
    expect(sim.state.events.open).toBeNull()
    expect(sim.state.quests.offer).toBeNull()
    expect(sim.state.quests.active?.id).toBe(offer.id)
  })

  it('questPolicyStep alone never accepts a regular offer: a job card holds it (the Golden Release, below, has no card)', () => {
    const sim = noOffers(makeSim(1))
    offerQuest(sim, 'rush_district')
    questPolicyStep(sim)
    expect(sim.commandLog.map((e) => e.cmd.kind)).toEqual(['debugOfferQuest'])
    expect(sim.state.quests.active).toBeNull()
  })

  it('nothing to do with no offer and no active quest; an active non-magic quest is left alone', () => {
    const sim = noOffers(makeSim(1))
    questPolicyStep(sim)
    expect(sim.commandLog).toEqual([])
    startQuest(sim, 'rush_district')
    const n = sim.commandLog.length
    questPolicyStep(sim)
    expect(sim.commandLog.length).toBe(n)
  })

  it('magic parcel: the job card accepted (decideEvent) and the origin rushed in the same step; no second rush while the flag is up; rushed again if the flag drops while it still waits; never once picked up; never the destination', () => {
    const sim = makeSim(1)
    const policy = createPolicy(sim, 'competent')
    policy.step() // opening A: a bike (with a driver) + the Metal detector
    runTicks(sim, 10)
    noOffers(sim)
    const offer = offerQuest(sim, 'magic_parcel')
    expect(sim.state.events.open?.questId).toBe(offer.id)
    const n = sim.commandLog.length
    policy.step()
    const pr = sim.state.quests.active?.progress
    if (pr?.kind !== 'magicParcel') throw new Error('no active magic quest')
    const origin = pr.origin!
    expect(sim.commandLog.slice(n).map((e) => e.cmd)).toEqual([
      { kind: 'decideEvent', eventId: 'job:magic_parcel', option: JOB_ACCEPT },
      { kind: 'rush', buildingId: origin },
    ])
    const p = sim.state.parcels[String(pr.parcelId)]!
    expect(p.state).toBe('waiting')
    expect(p.spawnedTick).toBe(sim.state.tick) // the rush lands on its spawn tick
    expect(isRushed(sim, origin)).toBe(true)
    // The flag is up: no second rush.
    const m = sim.commandLog.length
    questPolicyStep(sim)
    expect(sim.commandLog.length).toBe(m)
    // The flag dropped while the parcel still waits: rushed again.
    sim.state.buildings[origin]!.rushUntilTick = null
    questPolicyStep(sim)
    expect(sim.commandLog.slice(m).map((e) => e.cmd)).toEqual([
      { kind: 'rush', buildingId: origin },
    ])
    // Picked up (no longer waiting): never rushed again, the destination never.
    while (p.state === 'waiting') {
      policy.step()
      sim.tick()
    }
    sim.state.buildings[origin]!.rushUntilTick = null
    const k = sim.commandLog.length
    questPolicyStep(sim)
    expect(kinds(sim, k)).toEqual([])
    const rushed = sim.commandLog
      .map((e) => e.cmd)
      .filter((c) => c.kind === 'rush')
      .map((c) => (c.kind === 'rush' ? c.buildingId : null))
    expect(rushed.every((b) => b === origin)).toBe(true)
    expect(rushed).not.toContain(pr.dest)
  })

  it('the Golden Release waits while a regular quest is active (no Accept attempt), and is accepted on the step the slot frees; never declined or abandoned', () => {
    const sim = noOffers(quietSim(1)) // M9: the shipped cap is L5
    startQuest(sim, 'rush_district')
    sim.state.economy.lifetimeEarned = 16_000
    runTicks(sim, 1)
    const offer = sim.state.quests.offer
    expect(offer?.ultimate).toBe(true)
    const n = sim.commandLog.length
    questPolicyStep(sim)
    expect(kinds(sim, n)).toEqual([])
    // The regular quest ends (a timeout here): the next step accepts the ultimate.
    runTicks(sim, sim.state.quests.active!.deadlineTick! - sim.state.tick + 1)
    expect(sim.state.quests.active).toBeNull()
    const m = sim.commandLog.length
    questPolicyStep(sim)
    expect(sim.commandLog.slice(m).map((e) => e.cmd)).toEqual([
      { kind: 'acceptQuest', questId: offer!.id },
    ])
    expect(sim.state.quests.active?.ultimate).toBe(true)
    expect(
      sim.commandLog.filter(
        (e) => e.cmd.kind === 'declineQuest' || e.cmd.kind === 'abandonQuest',
      ),
    ).toEqual([])
  })

  it('the delegating kind runs the same rule', () => {
    const sim = noOffers(makeSim(1))
    const policy = createPolicy(sim, 'delegating')
    const offer = offerQuest(sim, 'rush_district')
    policy.step()
    expect(sim.state.quests.active?.id).toBe(offer.id)
    expect(sim.commandLog.map((e) => e.cmd.kind)).toContain('decideEvent')
  })

  it('game over: no quest accepted (decideEvent refuses after a game over; the policy stops)', () => {
    const sim = noOffers(makeSim(1))
    offerQuest(sim, 'rush_district')
    sim.state.economy.gameOver = true
    createPolicy(sim, 'competent').step()
    expect(sim.commandLog.map((e) => e.cmd.kind)).toEqual(['debugOfferQuest'])
    expect(sim.state.quests.active).toBeNull()
  })
})

describe('[long] quests under the competent policy, seeds 1-10 × 30 min (plan-build2 §8.4 acceptance)', () => {
  it("every regular offer (a job card) is accepted on the tick it was offered, through decideEvent; nothing expires, is declined or abandoned; every accept succeeds; the only other fail is the Golden Release on a malware delivery — that seed's lost life — judged by median like the gate's lives row", () => {
    const malwareFails: number[] = []
    for (const r of runs()) {
      const offered = r.events.filter((e) => e.name === 'quest:offered')
      expect(offered.length, `seed ${r.seed}`).toBeGreaterThan(0)
      for (const o of offered) {
        const a = r.events.find(
          (e) => e.name === 'quest:accepted' && e.questId === o.questId,
        )
        // The last offer of the run may land on the final tick.
        if (o.tick === 30 * TICKS_PER_DAY) continue
        // The Golden Release (offered on level:up {5}, before 30 min since
        // M9's retune) waits for the active regular quest to end — accepted
        // as soon as no quest is active (questPolicyStep), never declined.
        if (o.ultimate === true) {
          if (a !== undefined) {
            expect(a.tick, `seed ${r.seed} ultimate`).toBeGreaterThanOrEqual(
              Number(o.tick),
            )
          }
          continue
        }
        expect(a?.tick, `seed ${r.seed} ${String(o.questId)}`).toBe(o.tick)
        const d = r.events.find(
          (e) =>
            e.name === 'event:decided' &&
            e.kind === 'job' &&
            e.tick === o.tick &&
            e.eventId === `job:${String(o.templateId)}`,
        )
        expect(d?.label, `seed ${r.seed} ${String(o.questId)}`).toBe('Accept')
      }
      const declined = r.events.filter((e) => e.name === 'quest:declined')
      expect(declined, `seed ${r.seed}`).toEqual([])
      // Build 3 (M11): a malware delivery while the Golden Release runs
      // fails it (maxMalwareDelivered 0) on the tick it costs the life. That
      // life is the gate's lives row (median ≤ maxLivesLost, the 40-seed
      // share ≤ 35 %), so one seed may show it (seed 5 did at the build-2
      // thresholds): the fail is judged by median over the seeds, never per
      // seed. Any other non-timeout fail is a policy bug.
      const failed = r.events.filter(
        (e) => e.name === 'quest:failed' && e.reason !== 'timeout',
      )
      for (const f of failed) {
        const what = `seed ${r.seed} ${String(f.questId)} ${String(f.reason)}`
        expect([f.templateId, f.reason], what).toEqual([
          'golden_release',
          'malware',
        ])
        expect(
          r.events.some(
            (e) =>
              e.name === 'life:lost' &&
              e.cause !== 'event' &&
              e.tick === f.tick,
          ),
          `${what}: a malware life lost on its tick`,
        ).toBe(true)
      }
      malwareFails.push(failed.length)
    }
    console.log(
      `[quests] Golden Release failed on malware by seed: ${malwareFails.join(',')}`,
    )
    expect(median(malwareFails)!).toBeLessThanOrEqual(targets.maxLivesLost)
  }, 120_000)

  it('every magic parcel: its origin is rushed on its spawn tick (accept + rush in one step)', () => {
    let magic = 0
    for (const r of runs()) {
      for (const a of r.events.filter(
        (e) => e.name === 'quest:accepted' && e.templateId === 'magic_parcel',
      )) {
        magic += 1
        const spawned = r.events.find(
          (e) => e.name === 'parcel:spawned' && e.tick === a.tick,
        )
        expect(spawned, `seed ${r.seed} ${String(a.questId)}`).toBeDefined()
        const rush = r.events.find(
          (e) =>
            e.name === 'building:rushed' &&
            e.tick === a.tick &&
            e.buildingId === spawned!.origin,
        )
        expect(rush, `seed ${r.seed} ${String(a.questId)}`).toBeDefined()
      }
    }
    expect(magic).toBeGreaterThan(0)
  }, 120_000)

  it('gate rows by median: questsOffered30 ≥ questsOfferedBy30MinMin, questsCompleted30 ≥ questsCompletedBy30MinMin', () => {
    const m = runs().map((r) => r.result.metrics)
    const offered = median(m.map((x) => x.questsOffered30))!
    const completed = median(m.map((x) => x.questsCompleted30))!
    console.log(
      `[quests] offered by 30 min ${m.map((x) => x.questsOffered30).join(',')} (median ${offered}); completed ${m.map((x) => x.questsCompleted30).join(',')} (median ${completed})`,
    )
    expect(offered).toBeGreaterThanOrEqual(targets.questsOfferedBy30MinMin)
    expect(completed).toBeGreaterThanOrEqual(targets.questsCompletedBy30MinMin)
  }, 120_000)

  it('informational: a quest active between minutes 7 and 13 on ≥ 8/10 seeds; per-template counts (R-reach) — printed, never fails', () => {
    const m = runs().map((r) => r.result.metrics)
    const n = m.filter((x) => x.questActive7to13 === 1).length
    console.log(
      `[quests] active in minutes ${QUEST_PLATEAU.fromMin}-${QUEST_PLATEAU.toMin}: ${n}/${m.length} seeds (target ≥ ${QUEST_PLATEAU.seedsMin})${n >= QUEST_PLATEAU.seedsMin ? '' : ' — BELOW TARGET'}`,
    )
    for (const [id, t] of questTallies(m)) {
      console.log(`[quests] ${id.padEnd(18)} ${tallyText(t)}`)
    }
    const magic = m.reduce((s, x) => s + x.magicSpawned, 0)
    const onTime = m.reduce((s, x) => s + x.magicOnTime, 0)
    console.log(`[quests] golden parcels on time ${onTime}/${magic}`)
    expect(n).toBeGreaterThanOrEqual(0)
  }, 120_000)

  it('the full gate (seven playtest-1 windows + the two quest rows; M8: + the L3 rows; M9: + the L4-L5 rows; build 3: pass-1 runs, so the event rows stay informational until M14) passes by median on these runs; no seed breaks an invariant', () => {
    const g = summarise(
      runs().map((r) => r.result),
      {
        dataHash: data.hash,
        config: null,
        policy: 'competent',
        minutes: 30,
        targets,
        // The runs are pass 1 (decisions off): so is the gate's feature set.
        features: { ...SIM_FEATURES, events: false },
        eventPolicy: data.events.policy,
      },
    )
    expect(
      g.checks.filter((c) => c.note !== null).map((c) => [c.key, c.note]),
    ).toEqual(
      [
        'eventsOfferedBy30MinMin',
        'eventsOpenMaxTicks',
        'eventsL1PlateauMin',
        'policyEvPerCard',
        'policyNonDefaultShare',
      ].map((k) => [k, 'informational (M12)']),
    )
    expect(
      g.checks
        .filter((c) => c.note === null && !c.pass)
        .map((c) => [c.key, c.value]),
    ).toEqual([])
    for (const r of runs()) {
      expect(r.result.asserts, `seed ${r.seed}`).toEqual([])
      expect(r.conservation.ok, `seed ${r.seed}`).toBe(true)
    }
    expect(g.pass).toBe(true)
  }, 120_000)
})
