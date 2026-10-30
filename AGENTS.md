# pm-tycoon — agent rules

Package Management Tycoon: a portrait, pixel-art, isometric tycoon game (Phaser 4.2.1 + TypeScript 5.9 + Vite 8).
The plan lives outside this repo at /home/ruybot/agents/main/plans/pm-tycoon/ — build 2: `plan-build2.md` is the entry
point and `spec-build2.md` (cited `B2 §N`) wins over `spec-core.md` (cited `§N`) where they differ; `plan.md` §5, §6,
§12.1 and §13 still apply. Cite spec section numbers in commits and docs.
Phaser 4 recipes: `plans/pm-tycoon/phaser4-notes.md` and the linked skills under .agents/skills (`vlt skills link -y '#phaser'`).

## Commands (vlt only — never npm/pnpm/yarn/npx)

- Install: `vlt install`. Add a dependency by writing its exact version into package.json, then `vlt install`. The project vlt.json
  pins both registries to https://registry.npmjs.org/ under its `config` key (this VM's user config points at registry.vlt.io);
  commit vlt-lock.json and check `grep -c registry.vlt.io vlt-lock.json` prints 0.
- Run scripts: `vlr <script>`; script arguments go after `--`: `vlr sim -- --minutes 30 --seed 1`, `vlr dev -- --host`.
- One-off binaries: `vlx <pkg>`.
- Never start `vlr dev` / `vlr preview` in the foreground of a tool call (the harness hangs); use Playwright's webServer
  (`vlr e2e`, `vlr e2e:smoke`, `vlr shots`) or a detached process with a log file, and kill it when done.
- Any command expected to exceed ~60 s (`vlr e2e:install`, `vlr check`, `vlr sim:gate`, `vlr shots`, `vlr art:build`,
  `vlr audio:vendor`, `vlr build`) runs detached with a log and is polled with short calls:
  `mkdir -p .logs && nohup vlr check > .logs/check.log 2>&1 &` then `tail -n 20 .logs/check.log` until the `EXIT <code>` line.
  A long foreground call can hang the run and the tool caps at 10 min. `.logs/` is gitignored.

## Before every commit

- `vlr check` must exit 0: toolchain, typecheck, lint (+ sim purity), fmt:check, vitest, art:lint, quick sim gate (3 seeds,
  writes docs/gate/quick.* — never the committed latest.*), e2e smoke (builds first) or SKIPPED under the plan's §6.10 rules
  only (no test files, no art manifest, no policy.ts, no Chromium). `vlr check:quick` (the first five steps, gate tests
  excluded) is the pre-commit hook; the full check is the rule.
- Commit subject `<area>: <imperative summary>` (areas: scaffold, data, sim, city, warehouse, hud, audio, art, tools, tests,
  docs, people, quests, title, M0…M10); a body when the diff is not obvious; the last line is `Co-authored-by: Ruy Adorno <ruy@vlt.sh>`.
- No AI-attribution lines anywhere in commits, PR bodies or files (no "Generated with", no session links, no Co-Authored-By: Claude).
- `git commit --no-verify` is not allowed.
- Trunk only: commit directly to `main` in this checkout. Never create branches, worktrees, forks or pull requests; never run
  `gh pr …`, `gh repo create` or push to any branch but `main` (once a remote exists: `git push origin main`, no PR). This
  overrides Claude Code's default branch-then-PR habit — the run is autonomous and must never wait on a merge or review.
- Git remote: `origin` = https://github.com/ruyadorno/pm-tycoon.git (created by the author 2026-10-29, ruy-bot app
  installed on it). Push `main` only, at checkpoints: `source ~/.ghtoken && git push origin main` (~1 h GitHub App token
  refreshed into ~/.ghtoken; https only; never print or commit the token). If a push 403s or is refused for
  .github/workflows (the app may lack Workflows: write), stop retrying and record it in docs/report-playtest2.md.
- Subagents never commit: they edit disjoint files in this working tree (no worktree isolation), run checks and report back;
  the orchestrating agent reviews the diff, runs `vlr check` and commits on `main`.

## Code rules

- `src/sim/**` and `src/data/**` are headless: no Phaser, DOM, Date.now, performance.now, Math.random, timers; 10 ticks/s;
  seeded PRNG only (`tools/check-sim-purity.mjs` enforces it, and also keeps `src/ui/layout.ts`, `src/render/warehouse/RoomLayout.ts`,
  `src/render/{decayPhase,cityFx,quality,vehicleDepth}.ts`, `src/input/GestureClassifier.ts`, `src/audio/{chords,leadsheet,arranger}.ts` and `src/metrics/playtest.ts` free of Phaser/DOM value
  imports so Vitest can load them under Node). Scenes only read sim state and call the `ViewSim` facade
  (`src/sim/view-api.ts`), which builds a `Command` and calls `Sim.dispatch`; rendering never mutates sim state.
- Relative imports carry the `.ts` extension; erasable syntax only (no enums, parameter properties, namespaces) so Node 26 runs
  `tools/**/*.ts` and `src/sim` directly; JSON tables go through `src/data/index.ts` loaders (static imports under Vite,
  `fs` under Node) — no import attributes.
- Balance numbers live only in src/data/*.json; code never hard-codes a price, timer or threshold. A change there names the
  gate row that moved it (spec §7.6 order: level threshold → truck price → shelf cap → values).
- No new runtime dependency without a paragraph in docs/decisions.md (why, licence, size). Dev deps need no note.
- Sprites follow art/STYLE.md + art/manifest.json (canvas classes, anchors, headings, palette); scenes reference frames through
  `src/render/frames.generated.ts`; `vlr art:lint` fails off-contract pixels. Art swaps never require code changes.
- Two atlases: `world` (city, UI nine-slices, icons, the m5x7 glyph sheet — the HUD binds only this one) and `interior`
  (warehouse room, fixtures, machines, workers, faces), packed by the manifest's `atlas` key with hashed URLs; the logo
  (`public/assets/logo.png`) is brand art outside both atlases and the palette lint. BitmapText only (Text only in the debug overlay);
  integer camera zoom {1, 2}; no setScale/rotation/filters/flipX on world art; `scene.sleep/run` for view switches (never
  `start`); sim events are subscribed on WAKE/create and removed on SLEEP/SHUTDOWN, with `syncAll()` on wake.

## Art without a token

- `vlr art:build` is the offline loop (draw → gen-if-token → normalize → quantize → outline → variants → lint → atlas → gallery)
  and is idempotent (seeded procedural art, hashed finals).
- `vlr art:gen` needs PIXELLAB_TOKEN in the gitignored .env (already there; never paste it into chat, a commit or a log);
  without it the procedural placeholders stay and the script exits 0. One agent at a time calls PixelLab; `vlr art:balance`
  first. Build-2 budget 1,500 generations with a 300 reserve; the author approves or rejects ids after the run (G4–G6).

## Status and reports

- docs/status.md: one entry per checkpoint (M0–M10), newest first, in the format of plans/pm-tycoon/status.md; PARTIAL
  entries list unfinished task numbers. Copy the filled file back to plans/pm-tycoon/status.md at the end of M10.
- docs/decisions.md: every "(default — confirm)" choice taken (with the plan.md / plan-build2.md question number, build 2
  under "Run decisions (build 2)") and every runtime dep.
- docs/report-playtest2.md: the build-2 end-of-run report (plan.md §13.4 sections + plan-build2.md §8.7 task 6);
  docs/report-playtest1.md stays as the playtest-1 record.

## Sim gate

- `vlr sim -- --minutes 30 --seed N` prints the per-minute timeline; `vlr sim:gate` runs seeds 1–10 × 30 min and checks the
  windows of spec §7 + B2 §7.3 (first delivery < 60 s, scripted malware caught, L2 at 8–15 min, truck ≤ 4 min after L2,
  no lost life, no shelf stall under the Toss-everything policy; L3–L5 and quest rows as their `SIM_FEATURES` flags
  land); from M9 also `vlr sim:gate -- --minutes 35` (Golden Release row). Medians must pass; retune JSON, not code, in
  the B2 §7.3 tuning order.

## Scope guard (build 2 / playtest 2)

- Levels 1–5, quests, people (applicants, desks, the Hold Bay sorter, drivers); the fixed lane only — no belts of any kind,
  no management scene, no train, no splitters/traffic/day-night/bankruptcy, no PWA/service worker, no save migrations
  (v1 saves are discarded), no ready-made art packs. Pages deploy only through the `pages.yml` workflow dispatch at M10
  (Q-B2-9); GitHub mechanics beyond that and `git push origin main` stay out. The sorter is Toss-only (it never Clears).
