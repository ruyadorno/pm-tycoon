# Shot fixtures

`Sim.snapshot()` JSON files that `e2e/shots.spec.ts` loads through `__pm.load` (plan.md §6.9.3). Each one stores the
data hash of the tables it was made with. `__pm.load` refuses a fixture with a stale hash, and so does
`tests/data/shot-fixtures.test.ts` (part of `vlr check`). That test also checks that each fixture still sets up the
scenario its shot needs.

After any change to `src/data/*.json`, the sim state shape, a save-version bump (`STATE_VERSION` in
`src/sim/types.ts`; `Sim.load` refuses any other version, plan.md R9 / plan-build2 R19 — 5 since M8), a sim rule
that changes a seeded run, or a change to the policy (M7: it accepts every quest offer and rushes the golden parcel's
origin; M8: its L3 plan; M9: its L4-L5 plan), regenerate all of them (and the Title's attract snapshot,
`node tools/fixtures/attract.ts` → `src/assets/attract.json`, which follows the same rule) — `vlr fixtures` runs every
generator below in order:

```sh
node tools/fixtures/late-waiting.ts   # late-waiting.json
node tools/fixtures/warehouse.ts      # holdbay-full.json, malware-cleared.json, one-life.json
node tools/fixtures/m3.ts             # level-up.json, payroll-short.json, l2-lane.json
node tools/fixtures/people.ts         # people-l3.json, sorter-duty.json
node tools/fixtures/m8.ts             # level-up-3.json, l3-docks.json, overseas-malware.json
node tools/fixtures/m9.ts             # level-up-4.json, l4-room.json, level-up-5.json, l5-tycoon.json, victory.json
node tools/fixtures/attract.ts        # src/assets/attract.json (vlr fixtures:attract)
node tools/fixtures/warehouse.ts holdbay-full   # just one
```

All the generators are deterministic: seed 7 and the policy (`src/sim/policy.ts` — the competent kind, or the
`delegating` kind for `sorter-duty`), with no wall clock. Each fixture's top-level `fixture` record holds the
expectations the shots read, and its `regenerate` field holds the command that rebuilds it.

| Fixture | Scenario | Shot |
|---|---|---|
| `late-waiting.json` | One building with an amber waiting badge and one with a red badge (spawn ticks moved back). | `city-late-badge` |
| `holdbay-full.json` | The policy runs until 90 s, then nobody Tosses. The Hold Bay fills to its cap, and the next flagged parcel waits dark in slot 1 (`lane:stalled {holdBayFull}`). Load it without the policy. | `warehouse-stalled` |
| `malware-cleared.json` | The first malware that reaches the Hold Bay is Cleared. The snapshot is taken 3 s before that parcel is loaded from the shelf. With `?policy=1`, `life:lost` fires `fixture.lifeLostInS` later and the card reads "Cleared by you". | `lost-life` |
| `one-life.json` | The same run, with two debug malware deliveries first (1 life left). The cleared parcel's delivery ends the game `fixture.gameOverInS` later. | `game-over` |
| `level-up.json` | A plain run stopped 3 s before its level-up, or right after the last payout before the crossing one when two land in those 3 s (M7, seed 7: a bounty and a delivery; 2 s): lifetime earned just under the $2,000 L2 threshold (`fixture.lifetime`), one payout to go. With `?policy=1`, `level:up {2}` fires `fixture.levelUpInS` later, then `region:unlocked industrial`. | `level-up`, `industrial-unlocked`, `newspaper`, `shield-popover`, `warehouse-tier2` |
| `payroll-short.json` | The policy run 2 s before the day-4 payday with the balance patched to $0 (the one patch, in `fixture.patched`; not replay-exact). Load it without the policy: `payroll:short` names every worker (`fixture.unpaid`). | `payroll-short` |
| `l2-lane.json` | A plain run 40 s after the policy placed the Shaky shaker in slot 4: L2, tier 2, four live slots, a truck. Load it with `?policy=1`. | `warehouse-l2` |
| `people-l3.json` | A plain run: the competent policy past L2 until the shaker is in and the balance covers desk 2 — since M8 (cap 3) seed 7 is at a real L3 by then (`fixture.forced` false; `debugForceLevel 3` only if the run were still below L3) —, the machine in slot 3 removed (the policy's Battery checker at a real L3, the COUNTERS Metal detector at M6), desk 2 placed there, `postAd inspector` until a charisma-2 applicant shows up (`fixture.ads`), that one and the best other inspector hired into desk 2, 5 s of the policy. Desk 1 seats the start inspector; desk 2's two stations read their own p plus the colleague's charisma bonus, the readout the mean (`fixture.desks`, `fixture.charismaInspector`). Load it with or without `?policy=1`. | `warehouse-two-desks` |
| `sorter-duty.json` | A plain run of the `delegating` policy (a sorter hired at L2, the Hold Bay left to it), stopped on the tick the sorter tagged a held parcel `looks clean` — before the policy's next step would Clear it. `fixture.holdCardLine` is the parcel's hint line (`Mo: looks clean (85%)`). Load it without the policy: the sorter keeps working and the tagged parcel stays held. | `station-sorter`, `holdcard-sorter-hint` |
| `level-up-3.json` | A plain run stopped 3 s before the policy's real L3 (or right after the last payout before the crossing one, as `level-up.json`): L2, lifetime earned just under the L3 threshold (`fixture.lifetime`). With `?policy=1`, `level:up {3}` fires `fixture.levelUpInS` later, then `region:unlocked docks`, tier 3. | `level-up-3`, `docks-live`, `warehouse-tier3` |
| `l3-docks.json` | A plain run 30 s past the policy's dock 2 purchase, then on to the first tick where the Docks' soonest clearance is ≥ 20 s ahead (`fixture.clearingParcelId`, `fixture.clearInS`, `fixture.pierId`): L3+ (since M9 a real L4, tier 4 — seed 7's first Docks hand-off after dock 2 comes after its L4; `fixture.level`, `fixture.tier`), two docks, the clearance ring over the port office. With or without `?policy=1` that parcel clears `clearInS` later, then `hub:departure {docks}`. | `clearance-ring`, `ship-departure`, `warehouse-two-docks` |
| `overseas-malware.json` | A plain run 30 s past the policy's real L3, then `debugOverseasMalware {hub: 'docks'}` (a malware parcel of the newest strain handed off at the first pier, `fixture.parcelId`) and 5 s of the policy. With `?policy=1`, `life:lost {report.viaClearance}` fires `fixture.lifeLostInS` later — never before — and the card ends `Handed off at …` / `Cleared … — the ship has sailed`. | `lost-life-overseas` |
| `level-up-4.json` | A plain run stopped 3 s before the policy's real L4 (or right after the last payout before the crossing one): L3, lifetime earned just under the L4 threshold. With `?policy=1`, `level:up {4}` fires `fixture.levelUpInS` later, then `region:unlocked` for Low-density and Rural on the same tick (tier 4, slot 5, shelf 80). | `lowres-live`, `rural-live` |
| `l4-room.json` | A plain run 60 s past the policy's real L4: tier 4 (16 rows), slots 1-5 live (`fixture.fixtures` per slot), slot 6 locked, shelf 80. | `warehouse-tier4` (393×659 and 360×604, scrolled 0) |
| `level-up-5.json` | As `level-up-4.json` for L5: L4, lifetime just under the L5 threshold. With `?policy=1`, `level:up {5}` fires `fixture.levelUpInS` later, then `region:unlocked` Airport and Park & civic and `quest:offered {golden_release}` on the same tick (tier 5, slot 6, shelf 100). | `level-up-5`, `airport-live`, `civic-live`, `warehouse-tier5` |
| `l5-tycoon.json` | A plain run stopped on its `level:up {5}` tick: L5, tier 5, the Golden Release offered (`fixture.questId`) beside the policy's active regular quest (`fixture.activeQuestId`). Load it without the policy for the offer card (the active quest abandoned, the gold chip tapped); with `?policy=1` the first Airport clearance flies the plane `fixture.airportDepartureInS` later. | `golden-release-offer`, `plane-departure` |
| `victory.json` | A plain run stopped 3 s before its `game:victory` (the Golden Release one delivery short: `fixture.delivered` of `fixture.goal`). With `?policy=1`, `quest:completed` and `game:victory` fire on one tick `fixture.victoryInS` later; the HUD then autosaves the endless-mode run, whose Title Continue line ends `· Tycoon ✓`. | `victory`, `title-tycoon` |
