# Shot fixtures

`Sim.snapshot()` JSON files that `e2e/shots.spec.ts` loads through `__pm.load` (plan.md §6.9.3). Each one stores the
data hash of the tables it was made with. `__pm.load` refuses a fixture with a stale hash, and so does
`tests/data/shot-fixtures.test.ts` (part of `vlr check`). That test also checks that each fixture still sets up the
scenario its shot needs.

After any change to `src/data/*.json`, the sim state shape, or a sim rule that changes a seeded run, regenerate all of
them:

```sh
node tools/fixtures/late-waiting.ts   # late-waiting.json
node tools/fixtures/warehouse.ts      # holdbay-full.json, malware-cleared.json, one-life.json
node tools/fixtures/warehouse.ts holdbay-full   # just one
```

All the generators are deterministic: seed 7 and the competent policy (`src/sim/policy.ts`), with no wall clock. Each
fixture's top-level `fixture` record holds the expectations the shots read, and its `regenerate` field holds the
command that rebuilds it.

| Fixture | Scenario | Shot |
|---|---|---|
| `late-waiting.json` | One building with an amber waiting badge and one with a red badge (spawn ticks moved back). | `city-late-badge` |
| `holdbay-full.json` | The policy runs until 90 s, then nobody Tosses. The Hold Bay fills to its cap, and the next flagged parcel waits dark in slot 1 (`lane:stalled {holdBayFull}`). Load it without the policy. | `warehouse-stalled` |
| `malware-cleared.json` | The first malware that reaches the Hold Bay is Cleared. The snapshot is taken 3 s before that parcel is loaded from the shelf. With `?policy=1`, `life:lost` fires `fixture.lifeLostInS` later and the card reads "Cleared by you". | `lost-life` |
| `one-life.json` | The same run, with two debug malware deliveries first (1 life left). The cleared parcel's delivery ends the game `fixture.gameOverInS` later. | `game-over` |
