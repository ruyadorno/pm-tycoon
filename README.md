# Package Management Tycoon

A portrait, mobile-first, pixel-art isometric tycoon game (Phaser 4 + TypeScript + Vite): run a small courier
company, collect parcels across a sunny city, and catch the hidden "malware" parcels in your warehouse before
they reach a customer.

You are the dispatcher and the security chief. Bikes, vans and trucks drive on their own: you buy them, give them
home zones and rush them to busy buildings. Every parcel passes through your warehouse's intake lane, where an
inspection desk and machines (Metal detector, Shaky shaker) flag suspicious parcels into the Hold Bay. Toss or clear
each one: three malware parcels delivered to customers end the game, and every lost life comes with a card that
explains why it got through.

**Playtest 1** is company levels 1 → 2: two live districts, Industrial unlocking with the truck at level 2, two
machines, salaries and walkouts, three lives, one jazz track. Later levels show as fogged regions marked "coming
soon".

## How to play

The game teaches itself in about a minute:

1. **Buy a bike** — tap **Garage** and buy one; it heads out to collect waiting parcels.
2. **Watch the first delivery** — parcels go to the warehouse, through the lane and back out; the first delivery
   lands within a minute (gold `DELIVERED +$20`).
3. **Toss the first flagged parcel** — when a checker flags a parcel, open the **Warehouse**, tap the parcel in the
   Hold Bay and **Toss** it. Read the label: some flags are decoys, and clean parcels thrown away cost money.

Then grow: more vehicles, a second detector, rush buildings whose waiting badge turns amber or red, keep payroll
covered on payday, and reach level 2.

**The playtest brief: play twenty minutes cold**, without help or the debug flags. Level 2, the Industrial district,
the truck, the Shaky shaker and the tier-2 warehouse all arrive after minute 10. Then open the summary card (tap
❚❚ to pause, then ❚❚ again for the pause menu → **End run — show summary**; a ticker line also offers it at 20:00, and the Game Over card has a **Run summary** button),
press **Download playtest.json** and **Copy summary**, and note how it felt. docs/playtest.md explains the file and
the five fun-bar checks; docs/phone-checklist.md is the device checklist for the same session.

**Optional short session** (after the cold run, and only once its `playtest.json` is downloaded: the spicy data
replaces the cold run's save and profile on that origin): `?debug=1&config=spicy` loads `configs/spicy.json` — more malware
and decoys, a Hold Bay of 2 — so a Hold Bay stall and the lost-life card show up within minutes. `?debug=1` also
shows the fps/draw-call overlay, allows 4× speed (key `4`) and exposes `window.__pm` in the console.

### Controls

| Touch             | Desktop                 | Does                                                                   |
| ----------------- | ----------------------- | ---------------------------------------------------------------------- |
| tap               | click                   | select a building (rush it), a vehicle, the warehouse, a locked region |
| double-tap        | double-click            | zoom 1× ⇄ 2× at that point; on a vehicle: follow it                    |
| drag              | mouse drag / arrow keys | pan (with inertia)                                                     |
| pinch             | mouse wheel             | zoom 1× / 2×                                                           |
| long-press        | right-click             | district panel (satisfaction, favours, waiting parcels)                |
| HUD buttons       | `Space` / `1` / `2`     | pause / 1× / 2×                                                        |
| Warehouse, Garage | `W`, `G`                | switch views, open the Garage                                          |
| —                 | `Esc`, `F`              | close the top sheet/panel; follow the vehicle nearest the cursor       |

In the warehouse: tap a slot to buy or manage a machine or the desk, long-press and drag a fixture to move it, tap a
Hold Bay parcel for Toss / Clear. Sound starts with the first tap on the Title; the sax button mutes. Portrait only.

## How to serve on a phone

`dist/` is a static build: any web server works, plain http is fine (localStorage, WebGL and the sound-unlock tap all
work), there is no service worker. The hand-off zip (`vlr bundle` → `dist-zip/pm-tycoon-<sha>.zip`) contains `dist/`
with a `playtest-README.txt`.

1. **Desktop devtools, iPhone 16 preset.** Serve `dist/` (path 2, or `vlr build && vlr preview -- --host` from a
   clone), open `http://localhost:4173/` in Chrome, devtools → device toolbar → **iPhone 16** (393 × 852, DPR 3; add
   it as a custom device if the list lacks it) and reload.
2. **iPhone from the zip, served on the Mac's LAN.** Unzip, then

   ```sh
   cd dist && python3 -m http.server 4173
   ```

   and open `http://<mac-lan-ip>:4173/` in Safari on the iPhone (same Wi-Fi; `ipconfig getifaddr en0` prints the
   address; allow python3's incoming connections if macOS asks).

3. **GitHub Pages** (the final step). The repository is `github.com/ruyadorno/pm-tycoon` with Pages set to "GitHub
   Actions" and a custom domain: the site is `https://ruyadorno.com/pm-tycoon/`. `.github/workflows/pages.yml` is manual
   on purpose: Actions → **Pages** → **Run workflow** builds, checks and deploys `main`. Uncomment its `push` block to
   deploy on every push. `vite.config.ts` uses `base: './'`, so the same build works under `/pm-tycoon/`.
4. **SSH tunnel** — only if you have a route to the build VM: `vlr preview -- --host` there, then
   `ssh -g -L 4173:localhost:4173 <vm>` on the Mac and open `http://<mac-lan-ip>:4173/` on the phone.

Each origin (`localhost`, the LAN address, the Pages domain) keeps its own save and playtest profile.

## Develop

Needs Node ≥ 26 and vlt 1.6.0 (`npm i -g vlt@1.6.0`); vlt is the only package manager used here.

```sh
vlt install
vlr dev -- --host                 # http://localhost:5173 (and the LAN address); __pm is always on in dev
vlr check                         # toolchain, typecheck, lint, fmt, vitest, art lint, quick sim gate, e2e smoke
vlr sim -- --minutes 30 --seed 7  # the headless sim with the scripted policy, one row per in-game minute
vlr sim:gate                      # seeds 1-10 x 30 min against the playtest-1 pacing windows → docs/gate/latest.md
vlr e2e:install                   # once: Playwright's Chromium (no root); without it the e2e steps print SKIPPED
vlr shots                         # build + screenshots into shots/
vlr art:build                     # the offline art pipeline → public/assets/world.{png,json}
vlr build                         # production build → dist/
node tools/check-dist.mjs         # transfer budget (≤ 6 MB without source maps), atlas, samples, spicy.json
vlr bundle                        # dist/ → dist-zip/pm-tycoon-<sha>.zip
```

Long commands (`vlr check`, `vlr shots`, `vlr sim:gate`, `vlr art:build`) take a minute or more. `vlr art:gen` needs
a `PIXELLAB_TOKEN` in a gitignored `.env`; without it the procedural art is used and the pipeline still runs.

URL parameters (`src/debug/params.ts`): `seed=N`, `skipTitle=1`, `newGame=1`, `mute=1`, `audio=0`, `audiolog=1`,
`view=city|warehouse`, `fastForward=S` (sim seconds before the first frame), `policy=1` (the scripted player);
`debug=1` installs `window.__pm`, the overlay and 4× speed, and enables `config=<name>` (`public/configs/<name>.json`)
and `view=gallery`.

## Documents

| File                       | What                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `AGENTS.md`                | rules for coding agents working in this repo (commands, commits, code rules)             |
| `docs/report-playtest1.md` | the end-of-run report: what was built, how to play, screenshots, gate, open questions    |
| `docs/status.md`           | one entry per milestone (M0–M4)                                                          |
| `docs/decisions.md`        | every default taken, run decision, retune and runtime dependency                         |
| `docs/gate/latest.md`      | the latest 10-seed sim gate table                                                        |
| `docs/playtest.md`         | how to read `playtest.json` and the fun bar                                              |
| `docs/phone-checklist.md`  | the iPhone 16 + desktop devtools checklist                                               |
| `docs/art-todo.md`         | placeholders and generated sprites awaiting confirmation, art notes, the re-roll command |
| `art/STYLE.md`             | the art contract (palette, grid, light, canvas classes)                                  |
| `tests/fixtures/README.md` | the saved sim states the screenshot specs load, and how to regenerate them               |
| `CREDITS.md`               | font, art, audio and code credits with licences                                          |

The design documents (plan, mechanics spec, view specs, audio and style guides) live outside this repository.

## Licence

MIT (`LICENSE`). Third-party assets and libraries are listed in `CREDITS.md`; the instrument samples are CC-BY 3.0.
Nothing from Transport Tycoon or OpenTTD is used.
