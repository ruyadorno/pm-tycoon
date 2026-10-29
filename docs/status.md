# pm-tycoon — run status (playtest 1)

Filled in place by the playtest-1 run (format: plans/pm-tycoon/status.md); newest checkpoint entry first; copied back to plans/pm-tycoon/status.md as the last M4 step.

Run: started 2026-10-29 05:13 UTC — plan.md v1 — Node v26.12.1 / vlt 1.6.0 — Chromium: installed (Chrome for Testing 156.0.8078.4, SwiftShader WebGL, max texture 8192) — Playwright device: iPhone 16 — PixelLab token: present, Tier 2 (5,000 generations) — m5x7: vendored TTF — music: <pending M3> — current head: <updated per checkpoint>

## Milestone checklist

- [x] M0 scaffold + tooling + data tables + sim skeleton + procedural art + Gallery scene (commit `M0: …`)
- [x] M1 city loop: spawn → collect → pass-through warehouse → deliver → money; Garage sheet; autosave (commit `M1: …`)
- [x] M2 warehouse loop: fixed lane, checkers, Hold Bay, Toss/Clear, lives, lost-life card, game over (commit `M2: …`)
- [ ] M3 levels 1→2, Industrial + truck + Shaky shaker, payroll and walkouts, audio, polish (commit `M3: …`)
- [ ] M4 playtest instrumentation, summary card, build, screenshots, report, hand-off (commit `M4: …`)

## Gate results

Latest `vlr sim:gate` (seeds 1–10 × 30 min, medians) at 63af110 (M2); windows from spec §7 / `economy.pacingTargets`; `docs/gate/latest.md` is the full table.

| Gate                                                          | Window           | Median  | Min / max     | Pass                              |
| ------------------------------------------------------------- | ---------------- | ------- | ------------- | --------------------------------- |
| first delivery                                                | < 60 s           | 44.0 s  | 33.3 / 60.8   | PASS                              |
| first malware caught (scripted, flagged + tossed)             | present, ≤ 300 s | 261.4 s | 196.5 / 473.1 | PASS (median; 4/10 seeds > 300 s) |
| level 2                                                       | 8–15 min         | —       | —             | informational until M3            |
| truck bought after L2                                         | ≤ 4 min          | —       | —             | informational until M3            |
| lives lost (Toss-everything policy)                           | 0                | 0       | 0 / 1         | PASS                              |
| shelf stall                                                   | 0 s              | 0 s     | 0 / 0         | PASS                              |
| Hold Bay events per 10 min at L1 (`holdBayEventsPer10MinMin`) | ≥ 6              | 7.67    | 5.00 / 11.67  | PASS                              |
| malware share at 30 min (informational, post-cap escalation)  | —                | 5.0 %   | 5.0 / 5.0     | n/a                               |

JSON values retuned from spec §12: `parcels.malware.baseShare` 0.03 → 0.05 and `parcels.decoyShare` 0.10 → 0.20 — gate row `holdBayEventsPer10MinMin` (plan Q-R2 levers, after values in the §7.6 order) — 63af110; `economy.satisfaction.waitingPenaltyAfterS` 180 added (Q-RUN2, the spec §9.1 value moved into data, not a retune)
L3–L5 informational rows (build 2): <level 3 at <> min, level 4 at <> min, level 5 at <> min, or "counter capped at 2 — not measured">

## Checkpoint entries (newest first)

## M2 — warehouse loop — 2026-10-29 12:55 UTC — DONE at the `M2:` commit (sim part 63af110)

Built: the spec §6 lane (conveyor cap 6 → slots with buffers cap 2 → Hold Bay cap 3 → shelf; checkers with process timers, stations sharing one desk roll, the §6.3 roll cases, D(s) compounding, rate/detection readouts; stall propagation), the scripted first malware with forced catch + deferral, Toss/Clear with bounty/fee/satisfaction, fixtures buy/move/swap/remove + desk, hire/fire inspectors, lives + game over with the full life:lost trace, Q-RUN1 dock deadlock rules (yield, stall preference, relief) + soak test; WarehouseScene (RoomLayout + tests, lane renderer with the parcel pool and event tweens, dock view, workers, catch moment, Toss/Clear outcomes, stall visuals, readout + strain popover, wanted poster), BuySheet/SlotCard/HoldBayCard, drag-to-move fixtures; HUD bomb slots, Warehouse button pulse/red, first-flag funnel + scripted toast + toss hint + wanted list, LostLifeCard, GameOverCard, city catch/lost-life effects.
Gate: first delivery median 44.0 s; scripted malware flagged by the first checker and tossed on 10/10 seeds, firstMalwareCaught median 261.4 s (4/10 seeds > 300 s: the §4.5 nearest-first pickup tail leaves the scripted parcel waiting — Q-RUN3, M3); lives lost median 0 (seeds 1, 3 lose one at D = 0.97); shelf stall 0 s; Hold Bay events median 7.67/10 min at L1; wrong tosses 10.5/30 min.
Tests: 818 (vitest, 47 files: 817 passed, 1 todo); e2e: PASS (smoke M0–M2: room fits 393×659 and 360×604, forced flag → Hold Bay → badge → Toss); `vlr check` 39.5 s.
Shots (iPhone 16 + 360×604): `warehouse-l1` — the §1.3 rect table complete, desk + inspector, detector arch, locked slot 4 "Lv2", readout "Lane: 15/min · Detection 97%"; `warehouse-catch` — dark parcel mid-slide at +300 ms; `warehouse-holdcard` — label, route, "Flagged by: Inspection desk", value now, TOSS/CLEAR (CLEAR is blue: no green button face yet); `warehouse-stalled` — red readout, red rack lamp, pulsing slot outline; `warehouse-buysheet` — unlocked first, "Lv 3 · coming soon" rows; `lost-life` — route with mm:ss, catch rate, "Cleared by you at 06:21", lives row; `game-over` — stats, New game. All fit 360×604.
Deviations from spec-core.md: Q-RUN1 dock relief (shelf past cap only to end a single-dock jam); sold vehicles' inbound cargo goes through the lane; wrong Toss on a same-district parcel −3 once; generalist flags show no trait icon (decoy tell); busy checker is backpressure, not a stall; lost-life rates from the parcel's own rolls (docs/decisions.md).
Open for the author: Q-RUN1 (dock relief rule), the retuned shares, the first-flag funnel; Hold Bay bays compact after a Toss (a quick second tap can open the neighbour's card — the label is shown, nothing irreversible).
Next: PixelLab install, then M3

## M1 — city loop — 2026-10-29 08:40 UTC — DONE at the `M1:` commit (parent ecfc695)

Built: the spec §3–§5/§6.4–§6.5/§7.3/§9 world sim (trimmed road graph + cached A*, spawn with hidden malware/decoys and the scripted first malware, the §4.6 vehicle state machine + §4.5 greedy dispatcher with reservations, rush and home zones, one loading dock with the FIFO lot queue and idle-wait rule, the generic lane with pass-through slots, payouts with decay, satisfaction with both daily caps and drift), the competent policy (opening A) and the gate with `SIM_FEATURES` gating M2/M3 windows; CityScene (ground bake, buildings, fog + signs, interpolated vehicles, waiting badges tinted by decay phase, popups, tooltip, tap/double-tap/drag/pinch/long-press + desktop parity, follow, zone highlight, nav to the warehouse stub); the UI kit (Button, Sheet, Dialog, Toast, Panel); HudScene (top bar, ticker, toasts, chips, speed/mute/Warehouse/Garage, follow strip, paused/rotate cards, onboarding steps 1+3); GarageSheet + ZonePicker + DistrictPanel + ShieldPopover; autosave + Title Continue/New/Reset. The audio track (lead sheet, arranger, director, SFX, vendored samples) landed alongside, integration in M3.
Gate: first delivery median 39.4 s over seeds 1–10 (min 28.3 / max 56.4 s), shelf stall 0 s on every seed; malware/lives/Hold Bay windows informational until M2, L2/truck until M3. Deliveries/min at minute 10: median 9. Seed-1 30-min run: 240 deliveries, conservation holds, tick p99 0.09 ms.
Tests: 632 (vitest, 31 files: 630 passed, 1 skipped, 1 todo); e2e: PASS (smoke M0 + M1 groups: first delivery at 25.8 s sim, draw calls 3/frame, hit rects ≥ 44 px, chips row 265/309 px ≤ 348 at W 360); `vlr check` 30.1 s.
Shots (iPhone 16, + 430×932 column for two): `title` — clean, sign and title centred above the skyline; `city-0s` — empty lot, $450, onboarding step 1 pointing at Garage; `city-30s` (+430 column) — HUD numbers match the sim, step 3 card; `city-first-delivery` — gold "DELIVERED +$20" at the stop + money float; `city-zoom2` — followed bike at camera zoom 2, follow strip; `city-rush` — tooltip "Waiting: 1 · oldest 0:12 / Rushed · 0:59", bell + ring (the step-3 card overlaps the tooltip's last line — minor); `city-late-badge` — plain/amber/red counts distinct; `city-locked` — fogged Hoist Hill with its sign, active chip; `garage` (+430 column) — 3 fleet rows, unaffordable prices red, truck "Unlocks at Lv 2"; `garage-zone-picker` — Any/Node Heights/Registry Row + greyed locked rows; `district-panel` — satisfaction, favours, earned, waiting with oldest age; `paused` — scrim card, PAUSED ticker, ❚❚ latched. All in the STYLE.md look.
Deviations from spec-core.md: none in rules or numbers. View-level: `map.json lot.parking` re-ordered so the first bikes park on tiles the warehouse sprite does not hide (+2.5 s first delivery); top bar/ticker alpha 0.94 (0.85 let world labels read through); Warehouse/Garage buttons 92 px where W ≥ 393; onboarding step 3 waits until a building with waiting parcels is on screen; Phaser 4.2.1 tweens read Date.now(), so `__pm.freeze` drives tweens from the stepped delta (phaser4-notes §10 is wrong on this).
Open for the author: Q-RUN1 single-dock deadlock with a full shelf (decided in M2, see below); the Garage header/money toast show payroll copy before payroll exists (M3 makes it real).
Next: M2 warehouse loop

## M0 — scaffold + gallery — 2026-10-29 07:15 UTC — DONE at the `M0:` commit (parent d9f78d4)

Built: scaffold + `vlr check` tooling (8 steps, SKIPPED rules of plan §6.10), AGENTS.md/CLAUDE.md; the nine spec §12 tables byte-identical + `map.json` (avenues, trimmed/themed roads, blocks, lot, regions, 53 props, door offsets) + `schema.ts` validator; sim skeleton (Rng, typed events, §7.1 start state with the generic LaneNode chain, 12-step tick order with clock/day:ended, ViewSim facade, save/load, `vlr sim` CLI + gate report); procedural art pipeline (palette, STYLE.md, manifest, generators, normalize→…→atlas, lint A01–A14) → one 2048² `world` atlas (440 frames, 44 % fill) + m5x7 glyph sheet; boot chain (WebGL gate, shared AudioContext, Scale.NONE integer zoom, stepper, `__pm` debug API, Boot/Preload/Title), iso render core (iso.ts, ground bake, CameraRig, GestureClassifier, layout.ts) and the dev Gallery (palette, frames, full 48×48 map, HUD mock).
Gate: n/a — sim skeleton (sim:gate SKIPPED until src/sim/policy.ts exists, §6.10). `vlr sim -- --minutes 1 --seed 1` prints one row under plain Node (tick p99 0.026 ms).
Tests: 430 passing (vitest, 11 files incl. the audio track in progress); e2e: PASS (smoke, Chrome for Testing 156, SwiftShader, iPhone 16 profile); `vlr check` 15.5 s.
Shots: `shots/m0-map.png` — PASS: bright sunny palette, crisp 3× pixels, 1-px outlined readable silhouettes, correct iso depth, Hoist Hill fogged with its "Unlocks at Lv 2 / Trucks only" sign; `shots/m0-gallery.png` — PASS: every frame 1× over 2× on iso grass, m5x7 labels readable; `shots/m0-palette.png` — PASS: 15 ramps, reserved mal/gold marked; `shots/m0-hud.png` — PASS: nine-slices, icons, chips row, bottom bar with hit boxes. `world.png` sha256 ea92d45c… identical across two `vlr art:build` runs.
Deviations from spec-core.md: none in mechanics or numbers. Plan-level: `sign_locked`/`sign_pop` drawn 96×52 (city-view §1.4 says 48×32) so "Unlocks at Lv N" + "Trucks only" fit in m5x7; red is reserved for danger, so the red barn/roofs/bike of style-guide §4.2–4.3 are orange; Command union discriminant is `kind`; snapshots also carry `commandLog` (replay after reload); map `regions[].labelTile` nudged off avenues/footprints; zoom 2 is unreachable while `#game` is capped at 430 CSS px (code paths covered by tests).
Open for the author: the 48×1 `art/palette.png` + `art/contact/palette-ramps@4x.png` (G1, non-blocking); 66 procedural placeholders until the PixelLab pass; A12 warnings on 16 multi-material sprites (> 16 colours).
Next: M1 city loop (+ PixelLab anchor pass in parallel)

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

- G1 palette + STYLE.md: drawn 2026-10-29 (M0), presented in the end-of-run report — `art/palette.png`, `art/contact/palette-ramps@4x.png`, `art/STYLE.md`
- G2 anchor sheet: <not run | provisional (agent-approved ids: …, scores) | author-confirmed ids: … | rejected ids: …> — `art/contact/anchors@4x.png`
- G3 category sheets: <none | buildings-downtown <status>, buildings-highres <status>, buildings-industrial <status>, vehicles <status>, warehouse-interior <status>, procedural <status>>
- Placeholders still in use: <count from `vlr art:lint` warning A12> — ids listed in `docs/art-todo.md`

## Cost spent

- PixelLab: <N generations, $<usd> credits, balance before <> / after <>> (from `art/manifest.json#batches`; "$0 — procedural only" when no token; Tier 2 subscription, 5,000 gens/month)
- Retro Diffusion: $0 (expected; only with RD_API_KEY and after the author read its ToS)
- Other paid APIs: $0
