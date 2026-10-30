# Shot fixtures

`Sim.snapshot()` JSON files that `e2e/shots.spec.ts` loads through `__pm.load` (plan.md §6.9.3). Each one stores the
data hash of the tables it was made with. `__pm.load` refuses a fixture with a stale hash, and so does
`tests/data/shot-fixtures.test.ts` (part of `vlr check`). That test also checks that each fixture still sets up the
scenario its shot needs.

After any change to `src/data/*.json`, the sim state shape, a save-version bump (`STATE_VERSION` in
`src/sim/types.ts`; `Sim.load` refuses any other version, plan.md R9 / plan-build2 R19 — 4 since M7), a sim rule
that changes a seeded run, or a change to the policy (M7: it accepts every quest offer and rushes the golden parcel's
origin), regenerate all of them (and the Title's attract snapshot, `node tools/fixtures/attract.ts` →
`src/assets/attract.json`, which follows the same rule):

```sh
node tools/fixtures/late-waiting.ts   # late-waiting.json
node tools/fixtures/warehouse.ts      # holdbay-full.json, malware-cleared.json, one-life.json
node tools/fixtures/m3.ts             # level-up.json, payroll-short.json, l2-lane.json
node tools/fixtures/people.ts         # people-l3.json, sorter-duty.json
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
| `people-l3.json` | A plain run: the competent policy past L2 until the shaker is in and the balance covers desk 2, then `debugForceLevel 3` (the playtest cap is still L2, so Docks go live without M8's clearance — shots only), the Metal detector in slot 3 removed, desk 2 placed there, `postAd inspector` until a charisma-2 applicant shows up (`fixture.ads`), that one and the best other inspector hired into desk 2, 5 s of the policy. Desk 1 seats the start inspector; desk 2's two stations read their own p plus the colleague's charisma bonus, the readout the mean (`fixture.desks`, `fixture.charismaInspector`). Load it with or without `?policy=1`. | `warehouse-two-desks` |
| `sorter-duty.json` | A plain run of the `delegating` policy (a sorter hired at L2, the Hold Bay left to it), stopped on the tick the sorter tagged a held parcel `looks clean` — before the policy's next step would Clear it. `fixture.holdCardLine` is the parcel's hint line (`Mo: looks clean (90%)`). Load it without the policy: the sorter keeps working and the tagged parcel stays held. | `station-sorter`, `holdcard-sorter-hint` |
