// The M2 shot fixtures (plan.md §12.5 task 11, §6.9.3; warehouse-view.md
// §3.2 / §7.5; city-view.md §9.3-§9.4). Regenerate after any change to
// src/data/*.json, the sim state shape or a sim rule that moves a run (the
// snapshot carries the data hash, and __pm.load refuses a stale one;
// tests/data/shot-fixtures.test.ts fails `vlr check` until then):
//
//   node tools/fixtures/warehouse.ts            # all three
//   node tools/fixtures/warehouse.ts holdbay-full
//
// Every fixture is a plain Sim.snapshot() of a deterministic run — seed 7,
// the competent policy (src/sim/policy.ts) stepped before every tick like
// the CLI and ?policy=1 — plus logged commands only (no state patching), so
// __pm.replay() still matches after a load. A top-level `fixture` record
// (Sim.load ignores it) tells the shots spec what to expect.
//
//   holdbay-full     The policy until POLICY_OFF_S (bike, Metal detector,
//                    more bikes), then nobody Tosses: flags pile up until
//                    the Hold Bay is at cap and the next flagged parcel
//                    waits dark in its slot — `lane:stalled {holdBayFull}`.
//                    Snapshot STALL_SETTLE_S later. Load WITHOUT ?policy=1
//                    (the policy would Toss the bay empty on the first tick).
//   malware-cleared  The policy throughout, except that the first malware
//                    to reach the Hold Bay is Cleared (the `clear` command,
//                    on the tick it is held, before the policy's next step
//                    would Toss it). Snapshot LEAD_S before the vehicle that
//                    carries it is loaded: the parcel sits on the shelf
//                    with its ✓ badge. Load WITH ?policy=1 and advance:
//                    the run is the generator's, so `life:lost` lands
//                    `fixture.lifeLostInS` later (lives 3 → 2, the card
//                    reads "Cleared by you at m:ss").
//   one-life         As malware-cleared, but two debug malware deliveries
//                    (the `debugMalwareDelivery` command, logged) at
//                    DEBUG_LOSS_S cost two lives first: lives 1, and the
//                    cleared parcel's delivery is the third loss →
//                    `game:over` `fixture.gameOverInS` after the load.

import { mkdirSync, writeFileSync } from 'node:fs'
import { loadGameData } from '../sim/load.node.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { Sim } from '../../src/sim/sim.ts'
import { laneNode, TICKS_PER_S } from '../../src/sim/types.ts'
import type { Parcel } from '../../src/sim/types.ts'

const SEED = 7
/** holdbay-full: the policy stops (no more buys, no more Tosses) here. */
const POLICY_OFF_S = 90
/** holdbay-full: the stall has held this long when the snapshot is taken. */
const STALL_SETTLE_S = 2
/** malware-cleared / one-life: snapshot this long before the loading. */
const LEAD_S = 3
/** one-life: the two debug deliveries (each a lost life). */
const DEBUG_LOSS_S = [60, 75] as const
/** Give up if a scenario has not happened by then (sim seconds). */
const CAP_S = 1800
const OUT_DIR = new URL('../../tests/fixtures/', import.meta.url)
const REGENERATE = 'node tools/fixtures/warehouse.ts'

const data = loadGameData()

type Name = 'holdbay-full' | 'malware-cleared' | 'one-life'
const NAMES: readonly Name[] = ['holdbay-full', 'malware-cleared', 'one-life']

function write(name: Name, sim: Sim, fixture: Record<string, unknown>): void {
  const snap = {
    ...sim.snapshot(),
    fixture: {
      name,
      regenerate: `${REGENERATE} ${name}`,
      seed: SEED,
      tick: sim.state.tick,
      ...fixture,
    },
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const out = new URL(`${name}.json`, OUT_DIR)
  writeFileSync(out, `${JSON.stringify(snap)}\n`)
  const st = sim.state
  console.log(
    `${name}: tick ${st.tick} (${st.tick / TICKS_PER_S} s), lives ${st.economy.lives}, ` +
      `held ${laneNode(st.lane, st.lane.holdBayNodeId)?.queue.length ?? 0}, ` +
      `shelf ${laneNode(st.lane, st.lane.shelfNodeId)?.queue.length ?? 0}, ` +
      `${JSON.stringify(fixture)} → ${out.pathname}`,
  )
}

/** holdbay-full: policy to POLICY_OFF_S, then flags pile up to a stall. */
function holdbayFull(): void {
  const sim = new Sim(data, SEED)
  const policy = createPolicy(sim, 'competent')
  const off = POLICY_OFF_S * TICKS_PER_S
  while (sim.state.tick < off) {
    policy.step()
    sim.tick()
  }
  policy.dispose?.()
  const found: { stall: { nodeId: string; tick: number } | null } = {
    stall: null,
  }
  sim.events.on('lane:stalled', (p) => {
    if (p.reason === 'holdBayFull' && found.stall === null)
      found.stall = { nodeId: p.nodeId, tick: sim.state.tick }
  })
  const cap = CAP_S * TICKS_PER_S
  while (found.stall === null && sim.state.tick < cap) sim.tick()
  const at = found.stall as { nodeId: string; tick: number } | null
  if (at === null)
    throw new Error(`holdbay-full: no Hold Bay stall by ${CAP_S} s`)
  for (let i = 0; i < STALL_SETTLE_S * TICKS_PER_S; i++) sim.tick()
  const st = sim.state
  const lane = st.lane
  const hold = laneNode(lane, lane.holdBayNodeId)!
  if (!lane.stalled || lane.stallReason !== 'holdBayFull')
    throw new Error('holdbay-full: the stall cleared before the snapshot')
  if (hold.cap === null || hold.queue.length < hold.cap)
    throw new Error('holdbay-full: the Hold Bay is not at cap')
  const waiting = Object.values(st.parcels).find(
    (p) =>
      p.state === 'in_slot' && p.flaggedBy !== null && p.nodeId === at.nodeId,
  )
  if (!waiting)
    throw new Error(`holdbay-full: no flagged parcel waits in ${at.nodeId}`)
  write('holdbay-full', sim, {
    stallNodeId: at.nodeId,
    stalledAtTick: at.tick,
    waitingParcelId: waiting.id,
    held: hold.queue.slice(),
    heldMalware: hold.queue.filter((id) => st.parcels[String(id)]?.malware)
      .length,
  })
}

interface ClearedRun {
  sim: Sim
  parcel: Parcel
  clearedTick: number
  loadedTick: number | null
  lifeLostTick: number | null
  gameOverTick: number | null
}

/**
 * The policy, with the first held malware Cleared; runs until `stopTick`
 * (or, with stopTick null, until the cleared parcel costs its life).
 */
function clearedRun(debugLosses: boolean, stopTick: number | null): ClearedRun {
  const sim = new Sim(data, SEED)
  const policy = createPolicy(sim, 'competent')
  const run: Omit<ClearedRun, 'parcel'> & { parcel: Parcel | null } = {
    sim,
    parcel: null,
    clearedTick: -1,
    loadedTick: null,
    lifeLostTick: null,
    gameOverTick: null,
  }
  sim.events.on('parcel:loaded', (p) => {
    if (run.parcel && p.id === run.parcel.id && run.loadedTick === null)
      run.loadedTick = sim.state.tick
  })
  sim.events.on('life:lost', (p) => {
    if (run.parcel && p.parcelId === run.parcel.id)
      run.lifeLostTick = sim.state.tick
  })
  sim.events.on('game:over', () => {
    run.gameOverTick ??= sim.state.tick
  })
  const losses = debugLosses
    ? DEBUG_LOSS_S.map((s) => s * TICKS_PER_S)
    : ([] as number[])
  const cap = CAP_S * TICKS_PER_S
  while (sim.state.tick < cap) {
    if (stopTick !== null && sim.state.tick >= stopTick) break
    if (stopTick === null && run.lifeLostTick !== null) break
    if (losses.includes(sim.state.tick)) {
      const r = sim.dispatch({ kind: 'debugMalwareDelivery' })
      if (!r.ok) throw new Error('debugMalwareDelivery refused')
    }
    policy.step()
    sim.tick()
    if (run.parcel === null) {
      const hold = laneNode(sim.state.lane, sim.state.lane.holdBayNodeId)!
      const mal = hold.queue
        .map((id) => sim.state.parcels[String(id)]!)
        .find((p) => p.malware)
      if (mal) {
        const r = sim.dispatch({ kind: 'clear', parcelId: mal.id })
        if (!r.ok) throw new Error(`clear refused: ${JSON.stringify(r)}`)
        run.parcel = mal
        run.clearedTick = sim.state.tick
      }
    }
  }
  if (run.parcel === null)
    throw new Error(`no malware reached the Hold Bay by ${CAP_S} s`)
  policy.dispose?.()
  return run as ClearedRun
}

function cleared(name: 'malware-cleared' | 'one-life'): void {
  const debugLosses = name === 'one-life'
  const probe = clearedRun(debugLosses, null)
  if (probe.loadedTick === null || probe.lifeLostTick === null)
    throw new Error(`${name}: the cleared parcel was never delivered`)
  if (debugLosses && probe.gameOverTick !== probe.lifeLostTick)
    throw new Error(`${name}: the cleared parcel's delivery is not game over`)
  const snapTick = probe.loadedTick - LEAD_S * TICKS_PER_S
  if (snapTick <= probe.clearedTick)
    throw new Error(`${name}: loaded within ${LEAD_S} s of the Clear`)
  const run = clearedRun(debugLosses, snapTick)
  const st = run.sim.state
  const p = st.parcels[String(run.parcel.id)]!
  if (p.state !== 'on_shelf')
    throw new Error(`${name}: parcel ${p.id} is ${p.state}, not on_shelf`)
  const lives = debugLosses ? 1 : data.economy.lives.start
  if (st.economy.lives !== lives)
    throw new Error(`${name}: lives ${st.economy.lives}, expected ${lives}`)
  const inS = (t: number): number => (t - snapTick) / TICKS_PER_S
  write(name, run.sim, {
    parcelId: p.id,
    label: p.label,
    clearedAtTick: run.clearedTick,
    loadedInS: inS(probe.loadedTick),
    lifeLostInS: inS(probe.lifeLostTick),
    ...(debugLosses ? { gameOverInS: inS(probe.gameOverTick!) } : {}),
    destBuildingId: p.dest,
  })
}

const want = process.argv.slice(2)
for (const n of want) {
  if (!NAMES.includes(n as Name))
    throw new Error(`unknown fixture ${n} (${NAMES.join(', ')})`)
}
for (const n of want.length > 0 ? (want as Name[]) : NAMES) {
  if (n === 'holdbay-full') holdbayFull()
  else cleared(n)
}
