# Decisions log (playtest 1)

Every "(default — confirm)" choice taken during the run, numbered as in `plan.md` §14, with where it is coded;
every runtime dependency (why, licence, size); every deviation from the plan found while running. The author
overrules any line by number.

## Run-start findings (sanity check, 2026-10-29)

- **Remote exists.** `github.com/ruyadorno/pm-tycoon` was created by the author (public, Pages source "GitHub
  Actions", ruy-bot app installed on it) and this checkout is a clone with `origin` set and an initial README
  commit, so `git init -b main` was skipped. Per plan.md §13.2 ("once the author has created the remote, push with
  `git push origin main` only") the run pushes `main` at milestone checkpoints; no branches, no PRs, no Pages deploy.
  AGENTS.md's git-auth paragraph was updated to say so (the template predates the repo).
- **`.github/workflows/pages.yml` is committed last.** Whether the app token has Workflows: write cannot be checked
  without pushing a workflow file; holding it until the final commit means a refusal cannot block the checkpoint
  pushes. (plan.md §6.12 / Q58.)
- **PixelLab MCP already visible from the repo.** The author's registration covers both `~/agents/main` and this
  repo path at local scope, so the user-scope re-registration of plan.md §10 step (2) was skipped; the token was
  copied into the gitignored `.env` for the REST client without being printed. `GET /v2/balance`: Tier 2, 5,000
  generations, $0 credits.
- **Chromium**: Playwright 1.64.1 installs Chrome for Testing 156 without root; SwiftShader WebGL works (max
  texture 8192, `OES_standard_derivatives`); the `iPhone 16` descriptor exists (no R11 fallback needed).
- **`@types/node@26.6.6`** added as a dev dependency (not in plan.md §6.2): `tools/**` and `vite.config.ts` import
  `node:*` modules and `tsconfig.json` typechecks them; `types` is `["vite/client", "node"]`.
- **vite 8 / rolldown** rejects the object form of `manualChunks`; the phaser chunk is split with the function form.

## Runtime dependencies

- `phaser@4.2.1` — the engine (MIT). ~1.2 MB min / ~0.3 MB gz in its own chunk.
- `eventemitter3@5.0.4` — typed sim event bus imported by `src/sim` directly instead of through Phaser (MIT, ~3 KB).

## Defaults taken (plan.md §14)

Filled in as each is coded; the complete list is in the final report.
