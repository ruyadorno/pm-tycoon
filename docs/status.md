# pm-tycoon — run status (playtest 1)

Filled in place by the playtest-1 run (format: plans/pm-tycoon/status.md); newest checkpoint entry first; copied back to plans/pm-tycoon/status.md as the last M4 step.

Run: started 2026-10-29 05:13 UTC — plan.md v1 — Node v26.12.1 / vlt 1.6.0 — Chromium: installed (Chrome for Testing 156.0.8078.4, SwiftShader WebGL, max texture 8192) — Playwright device: iPhone 16 — PixelLab token: present, Tier 2 (5,000 generations) — m5x7: vendored TTF — music: <pending M3> — current head: <updated per checkpoint>

## Milestone checklist

- [ ] M0 scaffold + tooling + data tables + sim skeleton + procedural art + Gallery scene (commit `M0: …`)
- [ ] M1 city loop: spawn → collect → pass-through warehouse → deliver → money; Garage sheet; autosave (commit `M1: …`)
- [ ] M2 warehouse loop: fixed lane, checkers, Hold Bay, Toss/Clear, lives, lost-life card, game over (commit `M2: …`)
- [ ] M3 levels 1→2, Industrial + truck + Shaky shaker, payroll and walkouts, audio, polish (commit `M3: …`)
- [ ] M4 playtest instrumentation, summary card, build, screenshots, report, hand-off (commit `M4: …`)

## Gate results

Latest `vlr sim:gate` (seeds 1–10 × 30 min, medians) at <short sha>; windows from spec §7 / `economy.pacingTargets`; `docs/gate/latest.md` is the full table.

| Gate                                                          | Window           | Median | Min / max | Pass |
| ------------------------------------------------------------- | ---------------- | ------ | --------- | ---- |
| first delivery                                                | < 60 s           | <>     | <> / <>   | <>   |
| first malware caught (scripted, flagged + tossed)             | present, ≤ 300 s | <>     | <> / <>   | <>   |
| level 2                                                       | 8–15 min         | <>     | <> / <>   | <>   |
| truck bought after L2                                         | ≤ 4 min          | <>     | <> / <>   | <>   |
| lives lost (Toss-everything policy)                           | 0                | <>     | <> / <>   | <>   |
| shelf stall                                                   | 0 s              | <>     | <> / <>   | <>   |
| Hold Bay events per 10 min at L1 (`holdBayEventsPer10MinMin`) | ≥ 6              | <>     | <> / <>   | <>   |
| malware share at 30 min (informational, post-cap escalation)  | —                | <>     | <> / <>   | n/a  |

JSON values retuned from spec §12: <none | `file.key` old → new — §7.6 rule used — commit sha>
L3–L5 informational rows (build 2): <level 3 at <> min, level 4 at <> min, level 5 at <> min, or "counter capped at 2 — not measured">

## Checkpoint entries (newest first)

## M<n> — <name> — <YYYY-MM-DD HH:MM UTC> — <DONE | PARTIAL> at <short sha>

Built: <3–6 lines: scenes, sim modules, data touched>
Gate: <one line: first delivery median N s (seeds 1–10, min/max) | scripted malware caught on N/10 seeds | L2 median N min | n/a>
Tests: <N passing (vitest)>; e2e: <PASS | SKIPPED (reason)>; `vlr check` wall time <s>
Shots: <shots/*.png, one line each with the look verdict against art/STYLE.md, or "not captured on the VM (no Chromium) — capture on the phone">
Deviations from spec-core.md: <none | §ref: what and why>
Open for the author: <bullets; each is also added to docs/report-playtest1.md §Open questions>
Unfinished (PARTIAL only): <task numbers from plan.md §12>
Next: <M(n+1) | author playtest + GitHub push>

## Open questions raised during the run

Numbering continues after the consolidated list in plan.md; each line carries the default taken and where it is coded.

- Q-RUN1 <question> — default: <…> — code: <path or data key>

## Art approvals pending

- G1 palette + STYLE.md: <not sent | sent <date> | approved | changes requested: …> — `art/palette.png`, `art/contact/palette-ramps@4x.png`, `art/STYLE.md`
- G2 anchor sheet: <not run | provisional (agent-approved ids: …, scores) | author-confirmed ids: … | rejected ids: …> — `art/contact/anchors@4x.png`
- G3 category sheets: <none | buildings-downtown <status>, buildings-highres <status>, buildings-industrial <status>, vehicles <status>, warehouse-interior <status>, procedural <status>>
- Placeholders still in use: <count from `vlr art:lint` warning A12> — ids listed in `docs/art-todo.md`

## Cost spent

- PixelLab: <N generations, $<usd> credits, balance before <> / after <>> (from `art/manifest.json#batches`; "$0 — procedural only" when no token; Tier 2 subscription, 5,000 gens/month)
- Retro Diffusion: $0 (expected; only with RD_API_KEY and after the author read its ToS)
- Other paid APIs: $0
