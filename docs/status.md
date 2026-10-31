# pm-tycoon — run status (playtest 1 + builds 2–3)

Filled in place by the runs (format: plans/pm-tycoon/status.md); newest checkpoint entry first. Playtest 1 (M0–M4) was
copied back to plans/pm-tycoon/status.md at its end; build 2 (M5–M10, plan-build2.md) at M10; build 3 (M11–M15,
plan-build3.md) copies the file back at M15.

Run (build 3): started 2026-10-31 — plan-build3.md DRAFT v3 + spec-build3.md — from the part-B prompt with part A
never run (M11 → M15 in one run; no author feel-check notes; docs/decisions.md "Run decisions (build 3)") — Node v26 /
vlt 1.6.x — Chromium: installed (Chrome for Testing, SwiftShader WebGL) — Playwright device: iPhone 16 — PixelLab
token: present; budget 400 generations with a 100 reserve; 233 spent (2,422 → 2,189) — M11 7d2ec44, M12 617e97b, M13
f4cb2a4, M14 3b8bc50, M15 + the hand-off docs commit; zip dist-zip/pm-tycoon-a3c090e.zip; Pages dispatch refused (HTTP 403).

Run (build 2): started 2026-10-30 00:46 UTC — plan-build2.md DRAFT v2 + spec-build2.md — Node v26 / vlt 1.6.1 —
Chromium: installed (Chrome for Testing, SwiftShader WebGL) — Playwright device: iPhone 16 — PixelLab token: present,
Tier 2; budget 1,500 generations with a 300 reserve (author's run prompt); 877 spent, balance 3,299 → 2,422 — M10 at
13245fd + the hand-off docs commit; zip dist-zip/pm-tycoon-13245fd.zip; Pages dispatch refused (HTTP 403).

Run (playtest 1): started 2026-10-29 05:13 UTC — plan.md v1 — Node v26.12.1 / vlt 1.6.0 — Chromium: installed (Chrome for Testing 156.0.8078.4, SwiftShader WebGL, max texture 8192) — Playwright device: iPhone 16 — PixelLab token: present, Tier 2 (5,000 generations) — m5x7: vendored TTF — music: live, unheard on this VM (author to judge; offline render bars −22…−25 dBFS, peak 0.44) — current head: 77615ef (M4) + the hand-off docs commit; zip dist-zip/pm-tycoon-77615ef.zip

## Milestone checklist (build 3)

- [x] M11 pacing pass 1 + the events engine: windows, the threshold scan, the modifier registry, `events.json`, deck/effects/policy, gate rows, save v6 (commit `M11: …`)
- [x] M12 the cards on screen: EventCard / EventChip / EffectsCard, the hold, the category pictures, the Victory art, ~40 cards, the flag on (commit `M12: …`)
- [x] M13 the full deck: 100–120 cards, chains, routers, flags, jobs fully folded, the deck review, spicy (commit `M13: …`)
- [x] M14 pacing pass 2 with the deck on: thresholds, lives, the Golden Release at 0.85, long tests, fixtures (commit `M14: …`)
- [x] M15 playtest-3 build: metrics v3, summary card v3 + fun bar 3, shots, report, hand-off (commit `M15: …`)

## Milestone checklist (build 2)

- [x] M5 foundations + the author's fixes: logo + attract title, slab, bike, hop, modern port art, two atlases + hashed URLs, save v2, report §6 rough edges (commit `M5: …`)
- [x] M6 people: applicants, pips, charisma, salaries, desk 2, the Hold Bay sorter, drivers, hire sheets, faces, policies (commit `M6: …`)
- [x] M7 quests: engine, templates, magic parcels, rewards, chip/card, gate rows (commit `M7: …`)
- [x] M8 L3 Regional: Docks + overseas clearance, Battery checker, dock 2, Hold Bay 5, tier 3 (commit `M8: …`)
- [x] M9 L4 + L5 Tycoon: four regions, X-ray, Sorter Arm, dock 3, slots 5–6, Airport, tiers 4–5, Golden Release, Victory (commit `M9: …`)
- [x] M10 playtest-2 build: metrics v2, summary card v2, shots, report, Pages deploy, hand-off (commit `M10: …`)

## Milestone checklist (playtest 1)

- [x] M0 scaffold + tooling + data tables + sim skeleton + procedural art + Gallery scene (commit `M0: …`)
- [x] M1 city loop: spawn → collect → pass-through warehouse → deliver → money; Garage sheet; autosave (commit `M1: …`)
- [x] M2 warehouse loop: fixed lane, checkers, Hold Bay, Toss/Clear, lives, lost-life card, game over (commit `M2: …`)
- [x] M3 levels 1→2, Industrial + truck + Shaky shaker, payroll and walkouts, audio, polish (commit `M3: …`)
- [x] M4 playtest instrumentation, summary card, build, screenshots, report, hand-off (commit `M4: …`)

## Gate results

Latest `vlr sim:gate` (seeds 1–10 × 30 min, medians) at the M9 commit (data: docs/gate/latest.md; the table below is playtest 1's, the build-2 medians are in the newest entry and docs/gate/latest.md); windows from spec §7 / `economy.pacingTargets`; `docs/gate/latest.md` is the full table.

| Gate                                                          | Window           | Median    | Min / max     | Pass                        |
| ------------------------------------------------------------- | ---------------- | --------- | ------------- | --------------------------- |
| first delivery                                                | < 60 s           | 44.0 s    | 33.3 / 60.8   | PASS                        |
| first malware caught (scripted, flagged + tossed)             | present, ≤ 300 s | 174.3 s   | 154.4 / 197.7 | PASS (10/10 seeds)          |
| level 2                                                       | 8–15 min         | 13.05 min | 10.93 / 16.23 | PASS                        |
| truck bought after L2                                         | ≤ 4 min          | 2.10 min  | 0.92 / 5.11   | PASS                        |
| lives lost (Toss-everything policy)                           | 0                | 0         | 0 / 1         | PASS (seeds 3, 10 lose one) |
| shelf stall                                                   | 0 s              | 0 s       | 0 / 0         | PASS                        |
| Hold Bay events per 10 min at L1 (`holdBayEventsPer10MinMin`) | ≥ 6              | 7.15      | 4.31 / 9.20   | PASS                        |
| malware share at 30 min (informational, post-cap escalation)  | —                | 20.0 %    | 20.0 / 20.0   | n/a                         |

JSON values retuned from spec §12: `parcels.malware.baseShare` 0.03 → 0.05 and `parcels.decoyShare` 0.10 → 0.20 (M2, row `holdBayEventsPer10MinMin`), then `decoyShare` 0.20 → 0.22 (M3, same row, quick gate 5.97 → 7.87); `vehicles.truck.price` 1300 → 1200 (M3, row `truckAfterLevel2MaxMin`, §7.6 truck rule, quick gate +5.18 → +3.86 min); `economy.satisfaction.waitingPenaltyAfterS` 180 added (Q-RUN2, the spec value moved into data). Policy extensions COUNTERS + REHIRE (docs/decisions.md).
L3–L5 informational rows (build 2): counter capped at 2 — not measured (no `level:up {3}` in any 30-min run).

## Checkpoint entries (newest first)

## M15 — playtest-3 build — 2026-10-31 14:30 UTC — DONE at a3c090e

M14 is 3b8bc50. The hand-off: dist-zip/pm-tycoon-a3c090e.zip + the shots zip sent; `main` pushed; the one Pages
dispatch refused (HTTP 403, as in build 2) — the live site still serves an earlier build.
Built: the playtest recorder v3 (`src/metrics/playtest.ts`, `pm.playtest.v3`: `events {offered, decided, byCategory,
choices[] (id, option, default, kind, atS, thinkS, chain), thinkMedianS, chainsStarted, chainsFinished, chainsRunning,
livesLost, livesGained, vehiclesLost, workersLost, gameOverByEvent, modifiersPeak}` and `beats[]` in sim time; think
time = the wall time the EventCard showed the card); `src/metrics/funBar.ts` + SummaryCard v3 (Cards, Stories, Longest
quiet; fun bar 3's seven items; fits 360 × 604 exactly); `tests/playtest/seed-7.json` v3 from the 35-min automated run;
README / playtest-README / docs/playtest.md / docs/phone-checklist.md / docs/art-todo.md v3; four adversarial review
passes (sim, scenes, mobile, deck/copy on 30 random cards): 9 of 21 findings confirmed and fixed (a loss line capped at
the balance, `bills +$N/day`, `No jobs for 1 day`, think time not counted behind the rotate card, chains running);
`docs/report-playtest3.md`.
Gate (seeds 1–10 × 30 min, deck on — docs/gate/latest.md): PASS, unchanged from M14 — L2 10.73, L3 16.51, L4 20.55,
L5 25.33 (−8.4 / −8.2 / −8.1 / −8.6 % vs build 2), truck +2.30, lives 0, 21 cards, EV $24.4, non-default 0.52; 35-min
PASS (Golden Release 25.33); delegating PASS; 40 seeds PASS (L5 26.68, 12/40).
Tests: 3,101 passing (vitest, 126 files); e2e 170 passed / 146 project-gated skips; `vlr check` 186 s; cold install
(fresh clone + `vlt install` + `vlr check:quick`) PASS in 52 s; attribution grep 0; dist transfer 6.59 MB (≤ 8 MB)
Shots: 109 regenerated at this commit; `summary-card` and `summary-card-360x604` read (17 rows, fun bar 3 marks, the
buttons inside the card); `art/contact/events@4x.png` (G7) in situ
Seed-7 profile (policy, 35 min): 23 cards (16 decisions, 6 off the default; 5 jobs; 2 news), 2 chains (pairs),
133 beats, longest quiet on the ramp 95 s; fun bar 3: 1 judge, 2 fail (1:35 > 1:30), 3 fail (L2 10:44), 4 fail (pairs
only), 5 pass, 6 pass, 7 pending — the policy proxy; the human run decides
Deviations from spec-build3.md: no "slid" row (nothing slides under Q-B3-2) and the metrics departures D-M15-1…12 —
docs/decisions.md "Run decisions and deviations (M15)"
Open for the author: docs/report-playtest3.md §7 (Q-RUN12–Q-RUN21), G7, the playtest itself
Next: the author's playtest 3 (thirty to forty minutes cold on the iPhone 16)

## M14 — pacing pass 2 (deck on) — 2026-10-31 12:46 UTC — DONE at (this commit; sha recorded in the M15 entry)

M13 is f4cb2a4.
Built: the Golden Release at `minOnTimeRate` 0.85 (Q-B3-7); full gates with the shipped deck (no threshold nudge
needed — every level median in band); the long victory test, the delegating rows and the robustness sweeps with the
deck on; the M13 copy polish; fixtures regenerated (the victory fixture from seed 7); level times re-quoted.

| median (min, seeds 1–10)        | build 2    | M11 (deck off)  | M14 (deck on)         | Δ vs build 2 |
| ------------------------------- | ---------- | --------------- | --------------------- | ------------ |
| L2                              | 11.72      | 10.57           | 10.73                 | −8.4 %       |
| L3                              | 17.98      | 16.52           | 16.51                 | −8.2 %       |
| L4                              | 22.35      | 20.56           | 20.55                 | −8.1 %       |
| L5                              | 27.70      | 25.46           | 25.33                 | −8.6 %       |
| truck after L2                  | +1.54      | +2.78           | +2.30                 |              |
| Golden Release offered (35 min) | 27.70      | 25.46           | 25.33                 |              |
| 40 seeds: L5 · lives share      | —          | 26.11 · 13/40   | 26.68 · 12/40         |              |
| victory seeds 1–3 (≤ 40 target) | none by 45 | 47.6 / 49.5 / — | 48.82 / 56.60 / 47.62 |              |

Gate: `vlr sim:gate` PASS (cards 21, L1 plateau 4, EV $24.4, non-default 0.52, lives 0 with 2/10 seeds losing any);
35-min PASS (Golden Release 25.33, worst seed 29.04); `vlr sim:delegating` PASS (L5 26.22, lives 1, payroll 0.28);
40 seeds PASS (L5 26.68; L3–L5 only −5.6 / −3.8 / −3.7 % over 40 seeds — the band is a 10-seed rule).
Tests: 3,052 passing (vitest, 126 files); e2e smoke PASS; `vlr check` 189 s; shots 109 passed (`tests/playtest/seed-7.json`
rewritten from the 35-min run: L2–L5 at 10.7 / 15.9 / 20.6 / 24.9 min, no life lost)
Shots: regenerated; no layout change (copy only)
Deviations from spec-build3.md: victory by 40 min not met (the Golden Release's 5-day clock); the run stays at ≈ −8 %
(R26) — docs/decisions.md "Run decisions and deviations (M14)"
Open for the author: the Golden Release's 5-day clock vs victory ≤ 40 (Q-RUN9 continued)
Next: M15 playtest-3 build (metrics v3, summary card v3, report, hand-off)

## M13 — the full deck — 2026-10-31 11:58 UTC — DONE at (this commit; sha recorded in the M14 entry)

M12 is 617e97b.
Built: the full B3 §4 deck authored (145 cards + 4 routers), merged with M12's reviewed rows, judged by three
fresh-context reviewers on the sim's generated lines, and shipped at **115 cards** (29 whole singles cut, every chain
whole: gang, union, rival, investor, permit/hearing, audit, crate, strike, storm, ring + the outcome trios and pairs;
19 stories); copy edits, honest effects, weights + a 15-day cooldown floor; `tests/sim/chains-stories.test.ts` (every
shipped 4–5-card story driven through decideEvent, conditional branches both ways), a 60-min deck soak on seeds 1–3,
the EV band over seeds 1–10; jobs fully folded (spicy cadence, dead offer code removed, docs text); 12
`event-card-<category>` shots + `art/contact/events@4x.png` rebuilt in situ from them.
Gate (seeds 1–10 × 30 min, the shipped deck — docs/gate/latest.md): PASS — L2 10.73 (−8.4 % vs build 2), truck
+2.30, L3 16.51 (−8.2 %), overseas +2.95, L4 20.55 (−8.1 %), L5 25.33 (−8.6 %), lives 0 (2/10 seeds), quests 6 / 3,
21 cards by 30 min, 4 decision cards on the L1 plateau (≥ 3 on 10/10 seeds), EV $24.4 per card, non-default share
0.52, categories per run median 9, no `once` repeat, no card took a life, a vehicle or a worker; 35-min PASS (Golden
Release offered 25.33); delegating PASS (L5 26.22, EV $21.1); 40 seeds PASS (L5 26.68, 12/40 seeds lose a malware life).
Tests: vitest green (`vlr check` PASS, 188 s); shots 109 passed (the category cards, job, three, danger)
Shots (read): `art/contact/events@4x.png` — the 12 category cards in situ at 393 × 659 + the job board: every title
on one line, bodies ≤ 3 lines, effect lines coloured by tone, pictures on the darker inset
Deviations from spec-build3.md: the spec numbers changed on 20-odd cards and the 115-card ship list —
docs/decisions.md "Run decisions and deviations (M13)"
Open for the author: no feel-check notes were supplied — the review ran on the plan's rules; deferred copy edits go
to M14's copy polish
Next: M14 pacing pass 2 (deck on)

## M12 — the cards on screen (feel check) — 2026-10-31 10:05 UTC — DONE at (this commit; sha recorded in the M13 entry)

M11 is 7d2ec44 (+ 266015e, the M12 build checkpoint).
Built: `src/ui/effectText.ts` (the pure card model) + `EventCard.ts` (decision, three-option, job and news modes,
generated effect lines, `Can't afford`, `then:` / `Outcome depends on` / `— this can end the run`, PAUSED pill, the
read-in guard), `EventChip.ts` + the compact quest chip (row-B rule), `EffectsCard.ts` + the pause-menu entry,
HudScene plumbing (the card holds the sim; waits behind modals, the gold card and the level-up moment; ticker, SFX,
newspaper items, cell pulses; `?event=`, `?quest=` and the district row open the job card; the interim M11 job mode
retired), the lost-life and game-over event variants, VictoryCard art + confetti, SALE tags from `priceOf`, the
Garage refund at the paid price, the `/N` shelf readout, `vehicle:lost` / `parcel:lost` in the world scenes; the deck
at 62 cards (48 drawable, 40 at L1; the gang, investor, rival and audit chains); `SIM_FEATURES.events` **on**;
`e2e/events.spec.ts` (10 tests incl. the modal stack and the R34 legs); the art of B3 §5 (13 category pictures,
`victory_art`, `ic_event`, `fx_confetti`).
Gate (seeds 1–10 × 30 min, deck on — docs/gate/latest.md): PASS — first delivery 43.3 s, caught 10/10, L2 10.29,
truck +2.78, L3 16.73, overseas +2.55, L4 20.13, L5 25.46, lives 0, quests 6 / 3.5, **21 cards by 30 min**, no card
open past its step, **3 decision cards on the L1 plateau** (at the floor), **EV $25.0 per card**, **non-default share
0.63**; 35-min PASS (Golden Release offered 25.46); delegating PASS (L5 25.91, lives 1, EV $18.1); 40 seeds:
10/40 lose a malware life, but **L5 27.27 > 27** (recorded for M14, plan §8.3: not retuned here).
Tests: vitest green (`vlr check` PASS); e2e 156 passed / 120 project-gated skips; shots 96 passed
Shots (read): `event-card` (Protection, 227 px, greyed `Can't afford · $300`), `event-card-360x604`, `event-card-job`,
`event-card-three` (scanner course, `Send Audrey`, 277 px), `event-card-danger` (the recall at 1 life, red, `— this
can end the run`), `event-chain-gang` (`You chose: Deny`, `Bike 1 lost — your last vehicle` in red), `event-chip`,
`effects-card`, `event-lost-life`, `event-game-over`, `buysheet-sale`, `victory` + `victory-360x604` (art under
TYCOON, confetti over the top edge) — all in the STYLE.md look; draw calls 5 with a card open
Deviations from spec-build3.md: Enter takes the first option, never a danger or greyed one (D-M12-2); a card waiting
behind a sheet holds the sim; the copy-fit test lives in `tests/data/events-fit.test.ts` — docs/decisions.md (M12)
Open for the author: G7 (below); the feel check is optional now — `docs/feel-check-m12.md` (the run did not stop)
Next: M13 the full deck (100–120 cards), the deck review

## M11 — pacing pass 1 + events engine — 2026-10-31 06:30 UTC — DONE at (this commit; sha recorded in the M12 entry)

Built: the events engine of B3 §3/§6 headless — `src/sim/systems/deck.ts` (one scheduler for decision cards and job
cards: level bands, blank draws, two salted event streams, quiet rules, chains/routers/conditional next evaluated when
due, link inheritance, the queue, the rescue draw, jobs via `quests.ts offerJob` with the old offer timer and expiry
retired), `effects.ts` (every B3 §3.5 kind + the generated effect lines), `modifiers.ts` + `modifierOps.ts` (18 keys
at every B3 §3.6 read site, bounds, expiry, the stored paid price, `handOffTick`, `Subscriptions`), the hold
(`Sim.held`, `attachPolicy`; the stepper stops on it), `decideEvent` / `debugOfferEvent`, `policies/eventPolicy.ts`
(B3 §3.8 scores, −∞ for the last life), `STATE_VERSION` 6; `src/data/events.json` (schedule, categories, bounds,
weights, the 19-card seed deck + the audit router) + `checkEvents` (harsh-consequence rule, paid sibling, acyclic ≤ 5,
copy-fit placeholder); gate rows `eventsOfferedBy30MinMin`, `eventsOpenMaxTicks`, `eventsL1PlateauMin`,
`policyEvPerCard`, `policyNonDefaultShare` + informational rows, `--events on|off`; the interim job UI (QuestCard
Accept / Decline) and an interim auto-answer for non-job cards until M12; `SIM_FEATURES.events` **off**. Pacing pass
1: `newStrainDelayS` 90, thresholds L2 $1,750 / L3 $3,250 / L4 $4,650 / L5 $6,500, `perLevel` 0.015.
Gate (seeds 1–10 × 30 min, decision deck off, job cards on — docs/gate/latest.md): PASS — first delivery 43.3 s,
scripted malware caught 10/10, L2 **10.57** (−9.8 % vs build 2), truck +2.78, L3 **16.52** (−8.1 %), overseas +2.66, L4
**20.56** (−8.0 %), L5 **25.46** (−8.1 %), lives 0 (4/10 seeds lose one), quests offered 6 / done 3, payroll 0.21;
35-min gate PASS (Golden Release offered 25.46 ≤ 29); delegating PASS (informational: lives 1, payroll 0.28); 40 seeds ×
30 min: 13/40 seeds lose a malware life (32.5 % ≤ 35 %). Deck on (informational): L2 10.43 / L3 15.90 / L4 20.52 / L5
24.64 (−11.0 / −11.6 / −8.2 / −11.0 %), 21.5 cards by 30 min, 4 decision cards on the L1 plateau, EV $23.4 per card,
non-default share 0.40, 14 chains started and finished, no life taken by a card. Step time at L5 p99 ≤ 0.15 ms.

| median (min)        | build 2 | M11 (deck off) | Δ      | M11 (deck on, informational) |
| ------------------- | ------- | -------------- | ------ | ---------------------------- |
| L2                  | 11.72   | 10.57          | −9.8 % | 10.43                        |
| L3                  | 17.98   | 16.52          | −8.1 % | 15.90                        |
| L4                  | 22.35   | 20.56          | −8.0 % | 20.52                        |
| L5                  | 27.70   | 25.46          | −8.1 % | 24.64                        |
| truck after L2      | +1.54   | +2.78          |        | +2.30                        |
| 40-seed lives share | —       | 13/40          |        |                              |

Tests: 2,544 passing (vitest, 117 files; + stream isolation exact on seeds 1–10, save v6 mid-chain, v5 rejection);
e2e smoke PASS; `vlr check` wall time 167 s
Shots: `vlr shots` at this commit — 83 of 88 regenerated; `quest-offer` reads right (the job on the QuestCard with
Accept / Decline, "waiting for you", the $1,750 bar); 5 fail on the regenerated fixtures and held job cards
(`playtest-35min`, `docks-live`, `level-up-5`, `warehouse-tier5` ×2) — repaired with the shots of M12 (no card UI yet)
Deviations from spec-build3.md: blank draws instead of "retry next tick" (D-1); a second event stream for content
(D-2); no per-tick modifier cache (D-3); L5 threshold $100 under the plan's scan range (R26); a payday tick is quiet
for the deck — all in docs/decisions.md "Run decisions and deviations (M11)"
Open for the author: part A of the build-3 prompt never ran and the feel-check notes were empty — this run does
M11 → M15 in one go (docs/decisions.md, run-start findings)
Next: M12 the cards on screen (EventCard, EventChip, EffectsCard, HUD plumbing, the ~40-card deck, the flag on)

## M10 — playtest-2 build — 2026-10-30 17:20 UTC — DONE at 13245fd

Built: the playtest recorder v2 (`src/metrics/playtest.ts`, `pm.playtest.v2` + the per-config suffix: level 3–5 and
Victory times, `hires[]` with a `cheapest` flag, fired, ads, sorter, quests by template, overseas, docks, desks, endless);
`tests/playtest/seed-7.json` from a 35-minute automated run; the SummaryCard v2 with fun bar 2 (plan-build2 §9), offered
at 30:00 of game time and never before 25 real minutes; `public/configs/spicy.json` with a fast job board and the new
`tycoon.json` (a `start` recipe at L5 with a full lane and fleet, replayed through ordinary commands —
`src/boot/configStart.ts`, `src/data/configStart.ts`, also honoured by `vlr sim -- --config`); README / playtest-README /
docs/playtest.md / docs/phone-checklist.md / CREDITS.md / docs/art-todo.md v2; three whole-build review passes (sim,
scenes, mobile: 17 of 19 findings fixed — the recorder's same-tick losses, `debugForceLevel` booking fake income, the
rotate card hidden after full-screen cards, a VictoryCard lost on reload, keys under the rotate card, money floats on
top of each other, region chips unlocking off screen, an opaque top bar, the baseboard as an atlas frame, …);
docs/report-playtest2.md.
Gate: unchanged from M9 (outputs byte-identical): first delivery 43.3 s, scripted catch 178.3 s, L2 11.72, truck +1.54,
lives 0, shelf stall 0, Hold Bay 6.78, quests 7 / 3.5, L3 17.98, first clearance +2.18, L4 22.35, L5 27.70 — PASS;
35-min gate PASS (Golden Release offered 27.70); delegating PASS (informational, lives 1.5); victory long test PASS
(seed 2 wins at 45.70; the 45-min target waived pending the author).
Tests: 2,151 passing (vitest, 103 files incl. the long sweeps, + 1 todo); e2e: final full `vlr e2e` 135 passed / 104
project-skipped / 0 failed (8.9 min); `vlr check` ~158 s. Draw calls: city 3, warehouse 4 (6 while a dock loads), attract
Title 4. Dist 6.35 MB transfer (~4.32 MB gzip) of 8 MB; both atlases hashed.
Shots: 96 PNGs regenerated at the final tree (every one listed with its verdict in docs/report-playtest2.md §3) — new in
M10: `summary-card` (the 35-min seed-7 card: L2–L5 11:53 · 17:57 · 22:43 · 27:52, hires 7, quests 7 · 3 · 3, overseas
17 · 0, fun bar 2 ? ✓ ✓ ✗ ✓ ✓ — item 4 ✗ by design on a fast-forwarded run), `summary-card-360x604`. All in the STYLE.md
look.
Deviations from spec-core.md / B2: the fun-bar thresholds and the offer time live in code like playtest 1's; the tycoon
recipe (decisions.md "Run decisions and deviations (M10 — playtest-2 build)").
Open for the author: docs/report-playtest2.md §6 (rough edges), §7 (decisions to confirm, incl. the victory-by-45 waiver),
§9 (G4–G6 approvals), §10.5 (levers left).
Hand-off: `dist-zip/pm-tycoon-13245fd.zip` (6.57 MB; 6.35 MB transfer) + `dist-zip/pm-tycoon-shots-13245fd.zip` +
docs/report-playtest2.md sent; cold install of 13245fd: `vlt install` + `vlr check:quick` PASS in 46.4 s; `main` pushed.
Pages: `gh workflow run pages.yml` refused with HTTP 403 "Resource not accessible by integration" (the ruy-bot app lacks
Actions: write); one GET of https://ruyadorno.com/pm-tycoon/ → HTTP 200 serving the playtest-1 build
(`index-u7CqBocO.js`) — build 2 needs one manual run of the Pages workflow.
Next: author playtest (30–40 minutes cold on the iPhone 16, then the summary card)

## M9 — L4 + L5 Tycoon — 2026-10-30 14:39 UTC — DONE at bb5646e

Built: the level cap at 5 (B2 §9); L4 "National" (Low-density + Rural live with their unique art, X-ray, the Sorter Arm
into the Hold Bay station, the `dense` strain with typosquat labels, slot 5, shelf 80, dock 3, tier 4) and L5 "Tycoon"
(Airport live — ×2, S/M only, 20-s clearance, the plane departure — Park & civic live, slot 6, shelf 100, tier 5 with neon,
the Golden Release offered on `level:up {5}`, Victory → endless with the escalation from Victory and a ticker line,
`Tycoon ✓` on the Title); room growth 14/14/14/16/18 rows with a vertical drag only when the room does not fit (readout
fixed above it); the policy's L4/L5 plan + NEW STRAIN FIRST + the Arm taking over the Hold Bay; the balance pass; the
`dk_ship` and `xray` re-rolls; G5/G6 contact sheets; the ✓ glyph in m5x7.
Gate (30 min, data hash in docs/gate/latest.md): PASS, playtest-1 rows within ±5 % of M8 — first delivery 43.3 s,
scripted catch 178.3 s, L2 11.72, truck +1.54, lives 0 (2/10 seeds lose one), shelf stall 0 s, Hold Bay 6.78/10 min,
quests 7 / 3.5, L3 17.98, first clearance +2.18, **L4 22.35** (20–25), **L5 27.70** (25–30; seed 5 at 31.50 in the 35-min
run). 35-min gate PASS: Golden Release offered at 27.70 (≤ 32), dock 3 at 32.86. Delegating (informational): L5 28.02,
lives 1.5. Victory long test (informational): seed 2 wins at 45.70, seeds 1 and 3 have no victory by 48 min — below the
≤ 45-min target (waived pending the author, see Open). Retunes (decisions.md M9): L4 $9,000 → $5,200, L5 $16,000 →
$7,400, `customs_run` 3 / 5 days, `cheer_up` 52, dock 3 $1,000, `postVictoryPerDay` back to 0.01.
Tests: 2,099+ passing (vitest, 102 files incl. the long sweeps, + 1 todo); e2e: full `vlr e2e` 131 passed / 0 failed;
`vlr check` ~157 s. Draw calls: city 3, warehouse 6 (tier 5 scrolled 6). Atlases: world 80.3 %, interior 37.1 %. Dist
6.34 MB transfer (~4.32 MB gzip) of 8 MB.
Shots: `lowres-live`, `rural-live`, `civic-live` — each region in colour with NEW chips; `airport-live` — terminal, tower,
hangar, the plane on the runway (it faces across the runway: one heading); `level-up-5` — "LEVEL 5 — TYCOON", no "coming
soon"; `warehouse-tier4` (+360) — charcoal floor, steel walls, five slots, 0/80, dock 3 "$1,000" on a tag; `warehouse-tier5`
(+360, + scrolled) — terrazzo, neon, six slots, the shelf and bin reachable by scrolling with the readout fixed;
`golden-release-offer` (+360); `victory` (+360) — the TYCOON card, "Tycoon ✓" in the bar; `plane-departure`; `title` (L5
attract city); `title-tycoon` (+360) — "Day 46 · $3,580 · Lv 5 · Tycoon ✓". All in the STYLE.md look.
Deviations from spec-core.md / B2: rows 18 at tier 5 (B2 says 16; six slots at the 64-px pitch need 18), the thresholds
and prices above, NEW STRAIN FIRST, the scroll without a second camera (decisions.md M9).
Open for the author: **victory by 45 min** — the Golden Release's ≥ 90 % on-time rule fails against the L5 fleet
(industrial/rural parcels wait for trucks); options measured: the policy order "Arm before dock 3, dock 3 after the 3rd
truck" (seeds 2 and 3 by 45 min, never seed 1) or a softer on-time rate in `levels.json ultimateQuest` (spec says
unchanged) — the build keeps the spec; the lives row is fragile (15/40 seeds lose a life by 30 min; untried lever
`newStrainDelayS` 60 → 90); no scroll affordance in the tall rooms; G5 + G6 sheets (`art/contact/*@4x.png`).
Next: M10 playtest-2 build

## M8 — L3 Regional — 2026-10-30 11:15 UTC — DONE at 99ce939

Built: the level counter to 3 (`playtestMaxLevel` 3 — R1, 5 at M9) with the L3 row's unlocks from data (Docks live,
`battery` strain + Battery checker, Hold Bay 5, shelf 60, tier 3, dock 2 for $800); `systems/hubs.ts` — overseas
destinations at live hubs, the hand-off at a pier with a locked value, the 45-s clearance at the port office, malware
costing a life only at clearance ("… — the ship has sailed"), `hub:departure`; docks 2–3 (`buyDock`, round-robin feed into
slot 1, relief feeds one dock at a time, two- and three-dock soaks); `STATE_VERSION` 5; the room's tier 3 (green floor,
brick walls, the 20×5 shelf grid, roller pads and lamps for docks 2–3, the buy-dock dialog); the city's live port in
colour, the clearance ring over the port office, the ship departure, docked poses per bay; the overseas lost-life route,
hub tooltips and district panel; the policy's L3 plan (Battery checker → dock 2 → van → 2nd truck, REPLACE, desk 2 on the
dock-blocked rule); the L5 region art (fogged until M9); the attract city regenerated at L3.
Gate: PASS (data 9be64b60, Δ vs M7 0.0 % on every playtest-1 row): first delivery 43.3 s, scripted catch 178.3 s, L2
11.72 min, truck +1.54 min, lives 0 (2/10 seeds lose one), shelf stall 0 s, Hold Bay 6.78/10 min, quests 6 offered / 3
completed, **L3 17.98 min** (15–20; per seed 15.36–19.59), **first overseas clearance +2.18 min after L3** (≤ 3), 11
clearances, 0 lives lost at a clearance, dock 2 bought at 20.58 min. Retune: L3 threshold $5,000 → $3,700 (row
level3Min 22.38 → 17.98). Delegating (informational): L3 17.76, lives 1.5.
Tests: 1,925 passing (vitest, 97 files incl. the long sweeps, + 1 todo); e2e: full `vlr e2e` 112 passed / 0 failed;
`vlr check` 125 s. Draw calls: city 3, warehouse 6. Atlases: world 80.1 %, interior 31.8 %. Dist 6.26 MB transfer
(~4.29 MB gzip) of 8 MB.
Shots: `title` (+430×932) — the logo over the 30:00 L3 attract city (tier-3 brick exterior, six vehicles); `level-up-3` —
"LEVEL 3 — REGIONAL" over the dust, the Docks chip NEW, "$3,718 / $9,000"; `docks-live` — the port in colour, the ship at
its buoy; `clearance-ring` — the ring over the port office at zoom 2; `ship-departure` — the ship mid-sail (it slides
sideways — art note); `warehouse-tier3` (+360×604) — green floor, brick walls, 5 bays, 0/60 shelf, dock 2 "+$800", dock 3
"Lv4"; `warehouse-two-docks` (+360×604) — two tails, two green lamps, "2 docks 1 unloading"; `warehouse-dock-dialog`;
`lost-life-overseas` (+360×604) — "Handed off at Prefetch Pier 1 18:27 / Cleared 19:12 — the ship has sailed". All in the
STYLE.md look.
Deviations from spec-core.md / B2: R1 (cap 3 at M8), the L3 threshold retune, R7 roller pads, R9 REPLACE, docked pose by
position (decisions.md "Run decisions and deviations (M8 — L3 Regional)").
Open for the author: G5 — `art/contact/docks@4x.png` (live port), `airport@4x.png`, `civic@4x.png` (fogged until M9),
`art/contact/warehouse-tier3@4x.png`; the ship slides sideways on departure (art heading); for the M9 balance pass:
`customs_run` 0/5 completed (candidates count 3 / limitDays 5), `cheer_up` 0/8, delegating lives 1.5 (> 1).
Next: M9 L4 + L5 Tycoon

## M7 — quests — 2026-10-30 08:20 UTC — DONE at 11b6517

Built: `quests.json` (B2 §9) + `systems/quests.ts` (offer scheduler from day 3 every 2 days, 1-day decline/expiry
cooldown, one active quest, the Golden Release from `levels.json ultimateQuest` with no expiry; ten templates' goal
counters from sim events with a no-double-count property test; rewards: cash → lifetime earned, lives up to 5,
satisfaction outside the daily cap, ★ applicants through people.ts, vouchers; no penalty on fail — Q-B2-7) on its own
RNG stream, `systems/magic.ts` (the golden parcel: busiest sender → another live district within 20 road tiles,
checkers/sorter/Arm skip it, 120-s countdown, on time +1 life + $150), `game:victory` + `stats.victoryTick` + endless
escalation from victory, `STATE_VERSION` 4; QuestCard (offer / active / complete; gold frame for the ultimate),
QuestChip in the level row, VictoryCard (TYCOON, run stats, Continue / New game / Run summary), the district panel quest
row, ticker lines, the QUEST COMPLETE stamp + `questDone` SFX, the victory stinger, life slots 4–5, gold `ic_magic`
markers and rings in the city, the golden parcel in the lane, the voucher FREE row; the policy's quest rule; `?quest=`,
`debug.offerQuest`, `__pm.quests()`.
Gate: PASS (data 20c5e42e, Δ vs M6): first delivery 43.3 s (0 %), scripted catch 178.3 s (0 %), L2 11.72 min (−4.6 %),
truck +1.54 min (−20.2 %, earlier = better), lives 0 (4/10 seeds lose one), shelf stall 0 s, Hold Bay 6.78/10 min
(−1.3 %); quests offered by 30 min 6 (≥ 4), completed 3.5 (≥ 2); a quest active in minutes 7–13 on 10/10 seeds
(the L1 plateau has content); golden parcels on time 10/10. Retunes (decisions.md M7): `postVictoryPerDay` 0.01 →
0.005 (row maxLivesLost 0.5 → 0), `big_haul` count 5 → 3 and `on_time_day` 0.95/8 → 0.85/6 (row
questsCompletedBy30MinMin, B2 §3.2 reachability). Delegating (informational): lives 0.5, quests 6.5 / 4.
Tests: 1,651 passing outside the long sweeps (vitest, 86 files + 1 todo); e2e: full `vlr e2e` 100 passed / 0 failed; `vlr check` 118 s. Draw
calls: city 3, warehouse 6. Atlases: world 72.2 %, interior 29.0 %.
Shots: `quest-offer` (+360×604) — JOB BOARD "Rush hour · Node Heights · Reward $120", Accept · Later · Decline;
`quest-chip` — gold bar 4/10, `1d 18h`; `magic-parcel` — gold `2:00` chip, markers + rings over A and B;
`quest-complete` — gold stamp "QUEST COMPLETE +1 life +$150", toast "+1 life — 4 of 5", the Special Delivery paper;
`district-panel-quest` — "Rush hour · 1/6 · 2d 11h"; `victory-card` (+360×604) — TYCOON, six stats, three buttons. All
in the STYLE.md look; cosmetic: two money floats overlap on the quest-complete frame.
Deviations from spec-core.md / B2: design defaults Q1–Q22 (decisions.md "Run decisions and deviations (M7 — quests)");
the retunes above.
Open for the author: `cheer_up` is never completed by the policy (0/8; a human steering zones can) — candidates for the
M9 balance pass: `goal.value` 55 or a longer `limitDays`; `postVictoryPerDay` 0.005 also halves the endless ramp after
Victory (revisit at M9 when the cap reaches 5); G5 Rural — `art/contact/rural@4x.png`; tiers — `art/contact/tiers@4x.png`
(t3–t5 exteriors, used from M8/M9).
Next: M8 L3 Regional

## M6 — people — 2026-10-30 05:21 UTC — DONE at 1f0b631

Built: the people layer of B2 §2 — `employees.json` B2 §9 (roles with pip tables, applicants, desks, hold station),
`systems/people.ts` (three applicants per role on their own RNG stream, daily refresh, pips → numbers, salaries and
fees, ★ applicants with expiry, hire/fire/postAd), per-inspector detection with same-desk charisma (pCap 0.96; the desk
readout is the mean), desk 2 (`placeDesk`, L3, $400), `systems/sorter.ts` (the Toss-only Hold Bay sorter: wanted list
→ certain Toss, judgement → Toss or a `looks clean` tag, 2-s player grace; the Sorter Arm in the same station),
`state.wanted` in the sim, drivers (picker on every purchase, `Hire later`, Replace after the trip, speed/stop/
charisma/affinity), payroll with sorters, `STATE_VERSION` 3; the HireSheet (three cards: face, pips, $/day · fee, ★,
Post an ad), the Garage driver picker and `···` row menu, the StationCard, the desk card per inspector, the HoldBayCard
hint, the lost-life card naming the person with the better counter line, procedural faces/pips/★/`worker_sorter`/
`hold_station`/`station_outline`; the competent policy's applicant rules and the `delegating` policy (`vlr sim:delegating`).
Gate: PASS on every playtest-1 window (data 6225dd3d): first delivery 43.3 s, scripted catch 178.3 s (10/10), L2 12.28
min, truck +1.93 min, lives 0, shelf stall 0 s, Hold Bay 6.87/10 min. Δ vs M5: L2 −5.9 % and truck −8.1 % (outside
±5 %, accepted: the policy hires the fastest of three drivers — decisions.md M6), the rest within ±5 %. People rows:
payroll share 0.230 (≤ 0.25), 4 hires. Delegating (informational): lives median 1, sorter calls 37.5 / wrong tosses 3
/ missed 1, payroll share 0.27; seed 10 loses all three lives.
Tests: 1,344 passing outside the long sweeps (vitest, 77 files + 1 todo; the full check adds the long sweeps); e2e: full
`vlr e2e` 84 passed / 0 failed; `vlr check` 107 s. Draw calls: city 3, warehouse 6. Dist 5.53 MB (~3.66 MB gzip).
Shots: `hire-sheet` (+360×604) — three inspector cards with faces, eye/pace/charisma pips, catch % and time,
false-flag, `$/day · fee`, Hire, Post an ad $30, "New faces in 0:59"; `garage-driver-picker` — "Who drives the Bike?",
three driver cards, Hire later; `warehouse-two-desks` — desks in slots 1 and 3, desk 2 at 0.87 / 0.96 ("catch 92% avg");
`station-sorter` — the orange-vest sorter at the podium, the S on the rack lamp; `holdcard-sorter-hint` (+360×604) —
"Mo: looks clean (90%)" with the sorter's face; `warehouse-l1` — the locked station outline; `garage` /
`garage-430x932` — driver pips and `···`; `lost-life` — "Slot 1 desk — Audrey: …"; `city-zoom2` — "Bike 1 · Sem" with
speed pips. All in the STYLE.md look.
Deviations from spec-core.md / B2: design defaults D1–D20 (decisions.md "Run decisions and deviations (M6 — people)");
the ±5 % drift above; Re-hire is two taps (`···` → Re-hire) so Sell stays reachable.
Open for the author: G6 (people part) — `art/contact/people@4x.png` (faces, pips, ★, `worker_sorter`, the station, the
three machines); G5 (Low-density) — `art/contact/lowres@4x.png` (ten uniques, fogged until M9); the delegating lives row
(trusting the sorter's "looks clean" costs ~1 life per 30 min).
Next: M7 quests

## M5 — foundations + fixes — 2026-10-30 02:38 UTC — DONE at 67fd97a

Built: the Title as an overlay over an attract-mode City (`src/assets/attract.json`: seed 7, competent policy, 24 min,
the L2 city; camera tour `src/render/AttractCamera.ts`, 12-s legs + 1-s holds; Continue/New game swap in the real sim
under a fade; `?attract=0` keeps the old flow) with the author's logo (`tools/art/logo.ts`, 352×176, B2 §5); the
warehouse foundation as ground-bake slab/ramp/bollard tiles on the 4×4 footprint with exteriors regenerated without an
apron (lint A04 strict; B2 §6.1); the courier bike on a 32×32 canvas (B2 §6.2); the pickup hop sinking into the
vehicle body (B2 §6.3); the modern port (`dk_terminal_a/b`, `dk_port_office`; `dk_pier`/`dk_customs` rejected; B2 §6.4);
two atlases + content-hashed asset URLs (B2 §6.8, report §6.21); save v2 with a per-config key (report §6.13); report
§6.5/6.6/6.11/6.12/6.14/6.23/6.24 fixes. `economy.playtestMaxLevel` stays 2 (every "coming soon" reads it).
Gate: unchanged from M4 (no sim or data change): first delivery 44.05 s, scripted catch 174.3 s (10/10), L2 13.05 min,
truck +2.10 min, lives 0, shelf stall 0 s, Hold Bay 7.15/10 min — every median PASS; L3–L5 rows informational.
Tests: 1,204 passing (vitest, 73 files + 1 todo); e2e: full `vlr e2e` PASS (smoke, dist, lifecycle, audio,
audio-render, shots); `vlr check` 88 s. Draw calls: city 3, warehouse 6 (≤ 7), attract Title 4 (logged); attract Title
56.8 fps under SwiftShader (logged).
Shots: `title` / `title-430x932` — the logo over the moving L2 city, no HUD, New game / Reset / Credits, "tuning up…";
`city-lot-zoom2` — the debug crosses sit on the slab's corners, slab joints on the tile grid; `city-bike` — a
white-helmeted courier on an orange bicycle; `city-hop` (+ crop) — the parcel icon shrunk to 12 px sinking into the
cargo box; `docks-locked` — the fogged modern port (port office with radar mast, reach-stacker terminal, gantry
terminal, ship); `warehouse-l1` / `warehouse-tier2` — the room from the interior atlas; `garage` /
`garage-430x932` / `district-panel` — sized to their content; `level-up` — one dust cloud. All in the STYLE.md look.
Deviations from spec-core.md / B2: atlas placement by binder (B2 §6.8's interior list moved to world/both); hop shrink
by crop; worker scan frames a scripted edit of the PixelLab idle frames; the Phaser 4.2.1 keyboard-shutdown patch
(docs/decisions.md "Run decisions and deviations (M5)").
Open for the author: G4 — `art/contact/fixes@4x.png` (exterior t1/t2 on the slab, the 8 bike frames, the port in colour
and fogged, the hop crop): confirm or reject `wh_ext_t1`, `wh_ext_t2`, `bike`, `dk_terminal_a`, `dk_terminal_b`,
`dk_port_office`, the worker scan frames; the dust cloud reads as a flat blob (art call).
Next: M6 people

## M4 — playtest build — 2026-10-29 16:55 UTC — DONE at 77615ef

Built: the §12.9 playtest recorder (`src/metrics/playtest.ts`, 32 keys, `pm.playtest.v1` every 10 s and on hide, resumes after a reload of the same run) + `__pm.playtest()`/`downloadPlaytest()`; the SummaryCard (fun-bar ticks, Download playtest.json, Copy summary, Keep playing / New game) from the pause menu (❚❚ twice), the Game Over card and a one-time 20:00 offer; `tests/playtest/seed-7.json` from a 12-minute automated run; the build checks (`tools/check-dist.mjs`, `e2e/dist.spec.ts`: `__pm` absent without `?debug=1`), `public/playtest-README.txt`, docs/playtest.md, docs/phone-checklist.md, docs/art-todo.md, README "How to play" + "How to serve on a phone", CREDITS complete, the inert Pages workflow (committed last); three adversarial review passes fixed 3 sim bugs (unloadable save after large sales, damaged saves crashing after Continue → `src/sim/validate.ts`, a driverless vehicle loading a trip), 5 scene bugs (pan freeze on a HUD tap, a leaked 19 MB ground texture after New game, taps on hidden vehicles, a 2 s view-switch stall, vehicles clipped by multi-tile buildings) and 6 mobile/UI issues; new robustness sweeps and `e2e/lifecycle.spec.ts`.
Gate: unchanged from M3 (no balance change in M4): every window passes by median (first delivery 44.05 s, scripted catch 174.3 s, L2 13.05 min, truck +2.10 min, lives 0, shelf stall 0 s, Hold Bay 7.15/10 min); 5/10 seeds pass every window; no `level:up {3}`.
Tests: 1,082 (vitest, 64 files: 1,081 passed, 1 todo); e2e: `vlr e2e` 65 passed / 49 project-skipped / 0 failed (smoke, dist, lifecycle, audio, audio-render, shots); `vlr check` 83.0 s; cold install in a scratch copy: `vlt install` + `vlr check:quick` PASS in 27.3 s; AI-attribution grep over the history: 0.
Shots: 44 PNGs regenerated at the final tree, 44/44 PASS (one line each in docs/report-playtest1.md §3) — new: `summary-card` (+360×604), `paused` with "End run — show summary", `game-over` with "Run summary".
Dist: 4.88 MB transfer (~3.2 MB gzip) of the 6 MB budget; sourcemaps (14.6 MB) excluded from the budget and kept; the dev gallery removed before the hand-off build.
Deviations from spec-core.md: none new in M4 (decisions.md "Run decisions (M4)": save validation, walked-out driver at the dock, picking/depth rules, samples preloaded before the Title tap per audio.md).
Open for the author: everything in docs/report-playtest1.md §6–§9 (balance notes, desktop pause-menu keys, ticker pacing, unverified iOS-only behaviours, art approvals G1–G3, the music verdict).
Hand-off: dist-zip/pm-tycoon-77615ef.zip (5.4 MB) + docs/report-playtest1.md + pm-tycoon-shots-77615ef.zip sent; `main` pushed.
Next: author playtest (20 minutes cold on the iPhone 16 + desktop devtools) + the Pages workflow run

## M3 — levels/economy/audio/polish — 2026-10-29 14:32 UTC — DONE at 77061cd

Built: levels 1→2 with the playtestMaxLevel cap (bar keeps counting, "Lv 3 coming soon"), the Industrial unlock (region live, spawns 5 s later at satisfaction 60, slot 4, Hold Bay/shelf caps, tier 2, strain announcement then rattle after newStrainDelayS), post-cap malware escalation, payroll with unpaid marks, walkouts and re-hire, the full competent policy (+ COUNTERS/REHIRE extensions), Q-RUN3 scripted-origin rule, stable Hold Bay bays; PixelLab art installed (63 generated sprites, 3 procedural kept, one 2048² atlas at 53 %); audio wired (director in Boot, sample preload, Title tap unlock, mute, visibility, sim hooks, Credits card, e2e audio + offline render specs); city flourishes (unlock fade + ground re-bake, level-up dust/stamp/tier-2 swap, mood overlays, angry labels + grumble, honking queue, dock lights, smoke emitters, days-since sign, quality flags); warehouse tier 2 (cross-fade, slot-4 unroll, plates, poster), walkout/re-hire in the room; HUD level bar, newspaper, payroll toasts, Garage payroll header + No driver/Re-hire rows, mute wiring.
Gate: every playtest-1 window passes by median over seeds 1–10 (first delivery 44.0 s, scripted catch 174.3 s on 10/10 seeds, L2 13.05 min, truck +2.10 min, lives 0, shelf stall 0 s, Hold Bay 7.15/10 min at L1); per seed 5/10 miss at least one window (seeds 3, 10 lose a life; seed 3 truck +5.1; seed 5 first delivery 60.8 s; seeds 6, 8 Hold Bay < 6; seed 6 L2 16.2 min). No `level:up {3}` in 30 min. Malware share 20 % at 30 min.
Tests: 950 (vitest, 54 files: 949 passed, 1 todo); e2e: PASS — smoke (M0–M3 + audio boot), shots 38 PNG tests, audio.spec 4/4 (34 notes at 126 BPM after the tap, tape-stop, minor tag, hide/resume), audio-render (8 bars: peak 0.324, bar RMS −24.3…−22.9 dBFS; full pass tail −120 dBFS); `vlr check` 44 s.
Shots (new): `level-up` — dust frame 2, gold "LEVEL 2 — LOCAL" stamp, Industrial mid-fade, Hoist Hill chip NEW, bar "$2,015 / $5,000 · Lv 3 coming soon"; `industrial-unlocked` — colour Industrial, smoke on the chimneys; `newspaper` — THE NODE HEIGHTS GAZETTE, Day 13 / Lv 2, tier-2 photo; `shield-popover` — metal 99 %, rattle 89 % → Shaky shaker $300; `payroll-short` — $0, red "Payroll short: Audrey, Dee unpaid", Garage "!"; `city-10min` — L1 at 10:00, mood 29 (angry); `warehouse-tier2` / `warehouse-l2` (+360×604) — tier-2 room, slot 4 live, shaker in slot 4, Detection 99 %. M1/M2 shots regenerated with the PixelLab art. All in the STYLE.md look; fx_dust reads as a field of puffs rather than a cloud (art note).
Deviations from spec-core.md: Q-RUN3 scripted origin; policy extensions COUNTERS, REHIRE and the dock-blocked inspector rule; walkout "finishes its trip" interpretation (docs/decisions.md). Retunes: decoyShare 0.22, truck $1,200.
Open for the author: the lives window is dice (~19–29 % of 80 seeds lose one life in 30 min at D ≈ 0.97–0.99); mean satisfaction drifts angry under the policy during L2 (balance note, not tuned); the L1 stretch 7–13 min has nothing new to buy besides the van (fun-bar item 4 risk); the music is unheard on this VM.
Next: M4 playtest build

## M2 — warehouse loop — 2026-10-29 12:15 UTC — DONE at 820e4f4 (sim part 63af110)

Built: the spec §6 lane (conveyor cap 6 → slots with buffers cap 2 → Hold Bay cap 3 → shelf; checkers with process timers, stations sharing one desk roll, the §6.3 roll cases, D(s) compounding, rate/detection readouts; stall propagation), the scripted first malware with forced catch + deferral, Toss/Clear with bounty/fee/satisfaction, fixtures buy/move/swap/remove + desk, hire/fire inspectors, lives + game over with the full life:lost trace, Q-RUN1 dock deadlock rules (yield, stall preference, relief) + soak test; WarehouseScene (RoomLayout + tests, lane renderer with the parcel pool and event tweens, dock view, workers, catch moment, Toss/Clear outcomes, stall visuals, readout + strain popover, wanted poster), BuySheet/SlotCard/HoldBayCard, drag-to-move fixtures; HUD bomb slots, Warehouse button pulse/red, first-flag funnel + scripted toast + toss hint + wanted list, LostLifeCard, GameOverCard, city catch/lost-life effects.
Gate: first delivery median 44.0 s; scripted malware flagged by the first checker and tossed on 10/10 seeds, firstMalwareCaught median 261.4 s (4/10 seeds > 300 s: the §4.5 nearest-first pickup tail leaves the scripted parcel waiting — Q-RUN3, M3); lives lost median 0 (seeds 1, 3 lose one at D = 0.97); shelf stall 0 s; Hold Bay events median 7.67/10 min at L1; wrong tosses 10.5/30 min.
Tests: 818 (vitest, 47 files: 817 passed, 1 todo); e2e: PASS (smoke M0–M2: room fits 393×659 and 360×604, forced flag → Hold Bay → badge → Toss); `vlr check` 39.5 s.
Shots (iPhone 16 + 360×604): `warehouse-l1` — the §1.3 rect table complete, desk + inspector, detector arch, locked slot 4 "Lv2", readout "Lane: 15/min · Detection 97%"; `warehouse-catch` — dark parcel mid-slide at +300 ms; `warehouse-holdcard` — label, route, "Flagged by: Inspection desk", value now, TOSS/CLEAR (CLEAR is blue: no green button face yet); `warehouse-stalled` — red readout, red rack lamp, pulsing slot outline; `warehouse-buysheet` — unlocked first, "Lv 3 · coming soon" rows; `lost-life` — route with mm:ss, catch rate, "Cleared by you at 06:21", lives row; `game-over` — stats, New game. All fit 360×604.
Deviations from spec-core.md: Q-RUN1 dock relief (shelf past cap only to end a single-dock jam); sold vehicles' inbound cargo goes through the lane; wrong Toss on a same-district parcel −3 once; generalist flags show no trait icon (decoy tell); busy checker is backpressure, not a stall; lost-life rates from the parcel's own rolls (docs/decisions.md).
Open for the author: Q-RUN1 (dock relief rule), the retuned shares, the first-flag funnel; Hold Bay bays compact after a Toss (a quick second tap can open the neighbour's card — the label is shown, nothing irreversible).
Next: PixelLab install, then M3

## M1 — city loop — 2026-10-29 08:33 UTC — DONE at 460e515

Built: the spec §3–§5/§6.4–§6.5/§7.3/§9 world sim (trimmed road graph + cached A*, spawn with hidden malware/decoys and the scripted first malware, the §4.6 vehicle state machine + §4.5 greedy dispatcher with reservations, rush and home zones, one loading dock with the FIFO lot queue and idle-wait rule, the generic lane with pass-through slots, payouts with decay, satisfaction with both daily caps and drift), the competent policy (opening A) and the gate with `SIM_FEATURES` gating M2/M3 windows; CityScene (ground bake, buildings, fog + signs, interpolated vehicles, waiting badges tinted by decay phase, popups, tooltip, tap/double-tap/drag/pinch/long-press + desktop parity, follow, zone highlight, nav to the warehouse stub); the UI kit (Button, Sheet, Dialog, Toast, Panel); HudScene (top bar, ticker, toasts, chips, speed/mute/Warehouse/Garage, follow strip, paused/rotate cards, onboarding steps 1+3); GarageSheet + ZonePicker + DistrictPanel + ShieldPopover; autosave + Title Continue/New/Reset. The audio track (lead sheet, arranger, director, SFX, vendored samples) landed alongside, integration in M3.
Gate: first delivery median 39.4 s over seeds 1–10 (min 28.3 / max 56.4 s), shelf stall 0 s on every seed; malware/lives/Hold Bay windows informational until M2, L2/truck until M3. Deliveries/min at minute 10: median 9. Seed-1 30-min run: 240 deliveries, conservation holds, tick p99 0.09 ms.
Tests: 632 (vitest, 31 files: 630 passed, 1 skipped, 1 todo); e2e: PASS (smoke M0 + M1 groups: first delivery at 25.8 s sim, draw calls 3/frame, hit rects ≥ 44 px, chips row 265/309 px ≤ 348 at W 360); `vlr check` 30.1 s.
Shots (iPhone 16, + 430×932 column for two): `title` — clean, sign and title centred above the skyline; `city-0s` — empty lot, $450, onboarding step 1 pointing at Garage; `city-30s` (+430 column) — HUD numbers match the sim, step 3 card; `city-first-delivery` — gold "DELIVERED +$20" at the stop + money float; `city-zoom2` — followed bike at camera zoom 2, follow strip; `city-rush` — tooltip "Waiting: 1 · oldest 0:12 / Rushed · 0:59", bell + ring (the step-3 card overlaps the tooltip's last line — minor); `city-late-badge` — plain/amber/red counts distinct; `city-locked` — fogged Hoist Hill with its sign, active chip; `garage` (+430 column) — 3 fleet rows, unaffordable prices red, truck "Unlocks at Lv 2"; `garage-zone-picker` — Any/Node Heights/Registry Row + greyed locked rows; `district-panel` — satisfaction, favours, earned, waiting with oldest age; `paused` — scrim card, PAUSED ticker, ❚❚ latched. All in the STYLE.md look.
Deviations from spec-core.md: none in rules or numbers. View-level: `map.json lot.parking` re-ordered so the first bikes park on tiles the warehouse sprite does not hide (+2.5 s first delivery); top bar/ticker alpha 0.94 (0.85 let world labels read through); Warehouse/Garage buttons 92 px where W ≥ 393; onboarding step 3 waits until a building with waiting parcels is on screen; Phaser 4.2.1 tweens read Date.now(), so `__pm.freeze` drives tweens from the stepped delta (phaser4-notes §10 is wrong on this).
Open for the author: Q-RUN1 single-dock deadlock with a full shelf (decided in M2, see below); the Garage header/money toast show payroll copy before payroll exists (M3 makes it real).
Next: M2 warehouse loop

## M0 — scaffold + gallery — 2026-10-29 06:37 UTC — DONE at 5bce619

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

- Q-RUN1–Q-RUN3 (playtest 1): see docs/report-playtest1.md §7 (dock relief, waiting-penalty threshold, scripted origin).
- Q-RUN4 The people layer moves L2 −5.9 % and the truck row −8.1 % past plan-build2's ±5 % (the policy hires the fastest
  of three drivers) — default: accepted, no retune — code: `src/sim/policy.ts` `bestApplicant`.
- Q-RUN5 The level cap at M8 — default: 3 at M8, 5 at M9 (no L4/L5 rooms or live art until M9) — code: `economy.json
  playtestMaxLevel`.
- Q-RUN6 Six slots at the 64-px pitch need 18 rows, not B2's 16 — default: rows 14/14/14/16/18, the room scrolls —
  code: `src/render/warehouse/RoomLayout.ts rowsForTier`.
- Q-RUN7 Atlas placement — default: frames go where they are drawn (world: city, HUD, `src/ui`, room front layers;
  interior: room back layers; shared classes in both) — code: `tools/art/atlas.ts`, `src/render/frames.ts`.
- Q-RUN8 NEW STRAIN FIRST — default: a newly announced strain's counter is bought before older pending plan steps —
  code: `src/sim/policies/levelPlan.ts`.
- Q-RUN9 Victory by 45 min (plan-build2 §8.6) is not met: the Golden Release's ≥ 90 % on-time rule fails against the L5
  fleet — default: keep the spec's quest rules and B2 §7.2's order, waived pending the author — code: `levels.json
  ultimateQuest`, `tests/sim/victory.long.test.ts`.
- Q-RUN10 Threshold and price retunes (L3 $3,700, L4 $5,200, L5 $7,400, dock 3 $1,000; quest goals) — default: as in
  docs/decisions.md with the gate rows named — code: `levels.json`, `economy.json`, `quests.json`.
- Q-RUN12–Q-RUN21 (build 3): see docs/report-playtest3.md §7.2 (part A never ran; victory by 40 not met; ≈ −8 %
  not −10 %; spec numbers changed on ~20 cards; the investor declined; a card behind a sheet holds the sim; Enter
  takes the first option; engine, metrics and effect-line departures).
- Q-RUN11 The Pages dispatch is refused for the ruy-bot app (HTTP 403, no Actions: write) — default: recorded; the
  author runs the workflow by hand — code: `.github/workflows/pages.yml`.

## Art approvals pending

- G7 event pictures + Victory art (build 3): presented at M12 — `art/contact/events@4x.png` (13 `ev_pic_*` at 4× and in situ on EventCard mocks, `victory_art` on a VictoryCard mock, `fx_confetti`, `ic_event`); agent picks (`approved: false`): staff #2, fleet #2, customers #0, security #2 (judge swap), money #0, cityhall #0 (judge swap), weather #2, press #2, underworld #2, tech #0, port (re-roll), luck #0, job #2, victory_art #2; PixelLab 233 of 400
- G4 the four fixes (build 2, M5): presented — `art/contact/fixes@4x.png`; agent picks (`approved: false`): `wh_ext_t1` #6, `wh_ext_t2` (edit 1 of #6), `bike` #6 (courier, white helmet), `dk_terminal_a` #2, `dk_terminal_b` #1, `dk_port_office` #0; the worker scan frames (scripted edit); procedural: `lot_slab_a/b/c`, `lot_ramp`, `bollard_a/b`, `fx_dust_f0–f3`
- G5 region sheets (build 2): Low-density presented at M6 — `art/contact/lowres@4x.png` (ten uniques, agent picks); Rural presented at M7 — `art/contact/rural@4x.png` (ten uniques, agent picks); Docks (live), Airport, Park & civic presented at M8 — `art/contact/{docks,airport,civic}@4x.png` (agent picks, 2 candidates for L5)
- G6 tiers 3–5 + machines + people (build 2): presented — `art/contact/people@4x.png`, `art/contact/tiers@4x.png`, `art/contact/g6-tiers-machines-people@4x.png`, `art/contact/warehouse-tier3@4x.png` (agent picks `battery_checker`, `xray` (M9 re-roll), `sorter_arm`, `wh_ext_t3/t4/t5`; procedural faces, pips, ★, `worker_sorter`, `hold_station`, tier 3–5 interiors); commands in docs/report-playtest2.md §9

- G1 palette + STYLE.md: drawn 2026-10-29 (M0), presented in the end-of-run report — `art/palette.png`, `art/contact/palette-ramps@4x.png`, `art/STYLE.md`
- G2 anchor sheet: <not run | provisional (agent-approved ids: …, scores) | author-confirmed ids: … | rejected ids: …> — `art/contact/anchors@4x.png`
- G3 category sheets: <none | buildings-downtown <status>, buildings-highres <status>, buildings-industrial <status>, vehicles <status>, warehouse-interior <status>, procedural <status>>
- Placeholders still in use: <count from `vlr art:lint` warning A12> — ids listed in `docs/art-todo.md`

## Cost spent

- PixelLab build 3 (budget 400 / reserve 100): M12 233 generations (2,422 → 2,189) — the 13 category pictures, the port re-roll and the Victory art; $0 credits
- PixelLab build 2 (budget 1,500 / reserve 300): M5 126 generations (3,299 → 3,173); M6 207 (machines + Low-density); M7 276 (Rural + tier 3–5 exteriors); M8 220 (Airport + Park & civic at 2 candidates); M9 48 (dk_ship, xray re-rolls); M10 0; run total 877 of 1,500 (balance 3,299 → 2,422); $0 credits

- PixelLab: <N generations, $<usd> credits, balance before <> / after <>> (from `art/manifest.json#batches`; "$0 — procedural only" when no token; Tier 2 subscription, 5,000 gens/month)
- Retro Diffusion: $0 (expected; only with RD_API_KEY and after the author read its ToS)
- Other paid APIs: $0
