# Package Management Tycoon

A portrait, mobile-first, pixel-art isometric tycoon game (Phaser 4 + TypeScript + Vite): run a small courier
company, collect parcels across a sunny city, and catch the hidden "malware" parcels in your warehouse before
they reach a customer.

You are the dispatcher, the security chief and the boss. Bikes, vans and trucks drive on their own: you buy them,
pick who drives them, give them home zones and rush them to busy buildings. Every parcel passes through your
warehouse's intake lane, where inspectors at a desk and machines (Metal detector, Shaky shaker, Battery checker,
X-ray) flag suspicious parcels into the Hold Bay. Toss or clear each one: every malware parcel delivered to a customer
costs one of your lives (three to start), and every lost life comes with a card that explains why it got through.

The game: company levels 1 → 5 with all eight districts of the map, hired people with their own stats and salaries,
quests with a golden parcel, overseas hubs (the Docks and the Airport), a warehouse that grows through five tiers, and
the Golden Release that wins the game — then endless mode. The Title is the author's logo over a live demo city.
**Build 3 (playtest 3)** adds **event cards**: every minute or two the clock stops and a card asks you to run the
company — the crew wants a raise, a gang wants money, a storm is coming — with every option's effects printed under it;
job offers are cards too. The climb is about 10 % shorter than in build 2.

## How to play

The game teaches itself in about a minute:

1. **Buy a bike and pick its driver** — tap **Garage**, tap the Bike card ($200), then pick one of three applicants
   (`Who drives the Bike?`). The bike heads out to collect waiting parcels.
2. **Watch the first delivery** — parcels go to the warehouse, through the lane and back out; the first delivery
   lands within a minute (gold `DELIVERED +$20`).
3. **Toss the first flagged parcel** — when a checker flags a parcel, open the **Warehouse**, tap the parcel in the
   Hold Bay and **Toss** it. Read the label: some flags are decoys, and clean parcels thrown away cost money.

Then grow: more vehicles, a machine next to the desk, rush buildings whose waiting badge turns amber or red, keep
payroll covered on payday, decide the cards as they come (jobs included), and climb the levels.

**The playtest brief: play thirty to forty minutes cold** on the iPhone 16, without help or the debug flags, and answer
the cards as you like. Then open the summary card (tap ❚❚ to pause, then ❚❚ again for the pause menu → **End run — show
summary**; a ticker line also offers it at 30:00 of game time, once 25 real minutes have passed, and the Game Over and
Victory cards have a **Run summary** button), press **Download playtest.json** and **Copy summary**, and note how it
felt. The card ends with **fun bar 3** (seven checks); `docs/playtest.md` explains the file (`playtest.json` v3) and the
checks; `docs/phone-checklist.md` is the device checklist for the same session.

### Money, days and lives

- One in-game day is one minute at 1×. Payday is every day: inspectors, the sorter and the drivers are paid in that
  order; two unpaid paydays in a row and a person walks out (re-hire costs one day's salary).
- The level bar counts **lifetime earned** (`$3,010 / $3,250`), so spending never sets you back a level; quest cash
  counts too (cash from event cards does not: it only moves your balance).
- You start with $450 and **3 lives** (up to 5). A malware parcel delivered to a customer costs one; the lost-life
  card names the slot, the person or machine that missed it, and what would have caught it. A red option on a card can
  cost one too (its lost-life card says what you chose). No lives left: game over.
- Tossing a malware parcel pays a $50 bounty; tossing a clean one costs a $25 fee and some satisfaction. A district's
  satisfaction rises with on-time deliveries and falls with late ones, long waits and malware; happy districts send
  more parcels.

### The levels

| Level        | Lifetime earned | What opens                                                                                                                                                                                                         |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 · Scrappy  | start           | Node Heights (high-density) and Registry Row (downtown); bike $200, van $1,000; Metal detector $150 (the `metal` strain); 3 lane slots, Hold Bay 3, shelf 30                                                       |
| 2 · Local    | $1,750          | Hoist Hill (industrial — trucks only); truck $1,200; Shaky shaker $300 (`rattle`); slot 4, shelf 45; the Hold Bay station takes a sorter                                                                           |
| 3 · Regional | $3,250          | Shrinkwrap Shore (the Docks: overseas parcels pay ×1.5); Battery checker $500 (`battery`); a second desk $400; loading dock 2 $800; Hold Bay 5, shelf 60                                                           |
| 4 · National | $4,650          | Semver Street (low-density) and Pasture Peer Fields (rural); X-ray $1,000 (any strain, 70 %, 2 s a parcel); Sorter Arm $600; the `dense` strain with its typosquat labels; slot 5, loading dock 3 $1,000, shelf 80 |
| 5 · Tycoon   | $6,500          | Prefetch International (the Airport: S and M parcels only, ×2) and Monorepo Commons (park & civic); slot 6, shelf 100; the Golden Release                                                                          |

Each level-up is a moment: the warehouse rebuilds in a dust cloud into its next tier, the new region lifts its fog, and
a newspaper names what opened. Levels 2–4 each announce a new malware strain, which starts arriving 90 seconds later:
its own checker catches it 80 % of the time, the other checkers only 15 %, while inspectors and the X-ray catch every
strain alike. The malware share grows by 1.5 points a level (5 % at L1). The scripted test player reaches L2 at about
10.7 minutes, L3 at 16.5, L4 at 20.6 and L5 at 25.3 (the 10-seed sim gate's medians with the card deck on,
docs/gate/latest.md; game time — the pauses on cards come on top); a cold human is usually later.

### People and hiring

Every person is hired from a picker of **three applicants** with pips (●●●○○), a face, a salary and a hire fee (one
day's salary). Pools refresh every in-game day (`New faces in 0:23`); **Post an ad** ($30) rerolls the pool now. Talent
improves with the company level, and a ★ applicant (a quest reward) costs no fee and stays two days.

| Role      | Where                          | Pips                                          | What they do                                                                                                                                                                                                                                                       | Salary per day                                                                                     |
| --------- | ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Inspector | a desk, up to 3 each           | eye 1–5, pace 1–5, charisma 0–2               | eye: catch 75–94 %, false flags 20–10 %; pace: 5.0–3.0 s a parcel; charisma: +2 / +4 points to every **other** inspector at the same desk (cap 96 %)                                                                                                               | $8 + $2 × (eye + pace) + $4 × charisma ($12–$36)                                                   |
| Sorter    | the Hold Bay station (from L2) | judgement 1–5, pace 1–5                       | Toss-only: tosses the labels on the wanted poster and what it judges malware (70–95 % right), tags the rest `looks clean` for your Clear; one call every 8–4 s; it never Clears, so it can never cost a life, and leaves a parcel you tapped in the last 2 s alone | $10 + $3 × (judgement + pace) ($16–$40)                                                            |
| Driver    | a vehicle                      | speed 1–5, energy 1–5, charisma 0–2, affinity | speed: ×0.85–×1.15; energy: building stops ×1.3–×0.8; charisma: +1 satisfaction per on-time delivery (2: also per pickup); affinity: +1 speed pip in that vehicle type                                                                                             | class base × (0.4 + 0.1 × (speed + energy) + 0.1 × charisma), bike $8, van $15, truck $25 at 3/3/0 |

- **Desks.** Audrey (eye 3, pace 3) starts at desk 1; tap the desk for its card: each inspector's catch rate, Fire,
  Re-hire, **Hire inspector**, Move, Remove desk. The second desk ($400, L3) is a row of the slot buy sheet.
  Inspectors cost more than machines (a $150 Metal detector lifts the lane from 85 % to 97 %); people are the flexible
  choice.
- **The Hold Bay station** sits right of the Hold Bay rack. Tap it for **Hire a sorter** or, from L4, **Buy Sorter Arm**
  ($600, no salary, tosses every held parcel after 3 s unless you Clear it first). It seats one or the other.
- **Drivers.** Every vehicle purchase opens `Who drives the Bike?`; **Hire later** parks it as `No driver`. A Garage
  row's `···` menu has Replace driver (the swap waits for the trip to end), Fire driver, Re-hire and Sell.

### Cards

The first card opens at **3:20** of game time (Day 4; the HUD counts days from Day 1); after that a new one comes every
60–100 seconds of game time at L1, a little less often from L2 (60–110 s) to L5 (90–140 s). A card has a masthead
(`STAFF`, `FLEET`, `CUSTOMERS`, `SECURITY`, `MONEY`, `CITY HALL`, `WEATHER`, `PRESS`, `UNDERWORLD`, `TECH`, `PORT`,
`LUCK`, or `JOB BOARD` for a job), a picture, a short story and two or three options.

- **Every card pauses the game** (`PAUSED` in its corner) until you choose: no timer, no **Later**, nothing decided
  behind your back. The music plays on; the clock, the vehicles and the ticker wait.
- **Under each option is exactly what it does**, written from the game's own effects (costs in red, gains in green, the
  rest grey):
  `−$300`, `+1 life`, `all drivers: speed +1, charisma −1`, `bikes ×0.85 speed for 1 day`, `wanted list +1`. An
  option you cannot afford is greyed (`Can't afford · $300`) and always has a free sibling.
- **Danger cards**: a **red** option is the one that can hurt — it takes a life or a vehicle (`— this can end the run`
  when it could take your last life). An option that takes a life, a vehicle or a person always has a way out beside
  it, on the same card or on the card that started the story. A red button takes a tap only after a slightly longer
  look (0.6 s instead of 0.3 s, so a double tap never lands on it unread), and `Enter` never picks it. When a card takes
  a life, the lost-life card names the card and `You chose: …`; on the last life the Game Over card does.
- **Stories**: some options continue later (`…then: On the doorstep (in 1 day)`); the next card opens with `You chose:
  …`, and the last card's paper reads `<the story's title> — the story ends`. Some outcomes depend on how you play,
  never on dice (`Outcome depends on your catch rate …`).
- **News** cards have one **OK**: any tap closes them.
- **Jobs are cards too**: a `JOB BOARD` card with the objective, the reward and the time limit — **Accept** or
  **Decline**, no Later. A job card can come once no job is running and a day has passed since the last one ended.
- **The effects chip**: while a card's effect runs (a speed boost for a day, a cheaper truck, a permanent change), a
  small chip with the count of active effects sits in the top bar beside the level bar (it also shows, pulsing, when a
  card is waiting behind an open sheet: the game holds, and a tap brings the card up). Tap it, or **Effects · N** in
  the pause menu (❚❚, then ❚❚ again), for the list: each effect, its time left (or `permanent`) and the card that set
  it.
- If the fleet ever drops to zero and you cannot afford a bike, a neighbour wheels one over (with a rider) half a minute
  later.

### Quests

Job offers arrive as `JOB BOARD` cards (above). One job runs at a time; the chip next to the level bar shows its
progress and time left (tap it for the card and **Abandon**, which asks first). A failed or abandoned job costs
nothing; the next job card can come one day after a job ends (done, failed, declined or abandoned).

| Quest             | From                                     | Goal                                                                                                  | Time      | Reward                                            |
| ----------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------- |
| Rush hour         | L1                                       | deliver 6 / 10 / 14 / 18 / 22 parcels (by level) sent from the district with the most waiting parcels | 3 days    | $120 / $200 / $300 / $400 / $500                  |
| Cheer up          | L1, a district below 50                  | bring its satisfaction to 52                                                                          | 5 days    | $150 + 5 satisfaction there                       |
| Special delivery  | L1, after your first Toss, below 5 lives | carry the golden parcel from A to B before its gold ring runs out                                     | 2 minutes | +1 life and $150 (a few news cards give one too)  |
| Like clockwork    | L1                                       | one day with ≥ 85 % on time (at least 6 deliveries)                                                   | 3 days    | ★ driver Rae (speed 5, energy 4, charisma 1, van) |
| Clean sweep       | L2                                       | toss 3 malware in a row with no wrong Toss                                                            | 5 days    | ★ inspector Vera (eye 5, pace 3, charisma 1)      |
| Big haul          | L2                                       | deliver 3 XL parcels                                                                                  | 4 days    | $300                                              |
| Night shift       | L2                                       | 6 Hold Bay decisions with no Hold Bay stall                                                           | 4 days    | $250                                              |
| Customs run       | L3, the Docks live                       | clear 3 overseas parcels at the Docks                                                                 | 5 days    | $400                                              |
| Inspector general | L3                                       | lane detection ≥ 95 % against every announced strain for a whole day                                  | 4 days    | $500                                              |
| Express lane      | L5, the Airport live                     | clear 4 Airport parcels                                                                               | 5 days    | $600                                              |

**The Golden Release** is offered when you reach L5 on its own gold card — the one offer that is not an event card: it
does not pause the game, has no Decline, and **Later** keeps it waiting (decision cards hold back while it is open):
within 5 days, 60 deliveries, 0 malware delivered and ≥ 85 % on time (90 % in build 2). Shipping it wins: the
**TYCOON** card with the run's stats, then **Continue** (endless mode: quests keep coming, the malware share climbs 1
point a day up to 20 %, the Title's Continue line reads `Tycoon ✓`), **New game** or **Run summary**. The scripted
test player gets the offer at about 25.3 minutes, misses most offers on the 5-day clock (not on the on-time rate) and
wins at 47.6–56.6 minutes on seeds 1–3 (docs/decisions.md, M14), so a Victory inside a 40-minute session is a stretch.

### Overseas hubs

The Docks (L3) and the Airport (L5) are destinations, not senders: once a hub is live, about 15 % of new parcels are
bound overseas (Docks 2 : Airport 1), worth ×1.5 at the Docks and ×2 at the Airport, and twice as likely to be malware.
A vehicle hands the parcel off at the hub (its value is locked there), then it is cleared: 45 s at the port office, 20 s
at the Airport terminal. Malware costs its life at clearance, and the lost-life card ends `— the ship has sailed`
(`— the plane has left`); the ship sails out and the plane takes off on clearances. A hub is served by vehicles with no
home zone (`Any`) and by those homed in Hoist Hill or Monorepo Commons (the Docks) or in Semver Street or Registry Row
(the Airport).

### The warehouse

The room is one fixed lane: parcels come in at a loading dock on the west wall, ride the conveyor down the belt column
past each slot (a desk or a machine), flagged ones drop down a chute into the Hold Bay rack (the station and the
Quarantine Bin beside it), and the rest wait on the shelf for a vehicle out. A parcel is checked at each slot in turn, so
every desk and machine adds its own chance to catch it (an 85 % desk plus an 80 % Metal detector is 97 % against
`metal`); tap the shield in the top bar for the lane's rate against every strain. A full Hold Bay stops the lane, and
so does a full shelf.

| Tier | Level | Outside                                        | Inside                                                             | Rows |
| ---- | ----- | ---------------------------------------------- | ------------------------------------------------------------------ | ---- |
| 1    | L1    | a scrappy shed on the concrete slab            | 3 slots, Hold Bay 3, shelf 30                                      | 14   |
| 2    | L2    | the same shed with cream trim and a sign board | 4 slots, shelf 45                                                  | 14   |
| 3    | L3    | a red-brick depot with two bays                | green floor, brick walls, Hold Bay 5, shelf 60, dock 2             | 14   |
| 4    | L4    | grey steel, three bays, a logo board           | charcoal floor, steel walls, a forklift, 5 slots, shelf 80, dock 3 | 16   |
| 5    | L5    | a white glass HQ with a pink neon sign         | terrazzo, neon strips, a delivery robot, 6 slots, shelf 100        | 18   |

At tiers 4–5 the room can be taller than the space between the HUD bars — tier 5 is on an iPhone 16 in Safari (393 ×
659 with the toolbars) and at 360 × 604, tier 4 only slightly; it fits on taller screens such as a Pro Max and in
devtools' 393 × 852 preset: **drag it up and down** (the mouse wheel on a desktop); the lane readout stays fixed above
it. A drag that starts on a fixture
scrolls too; hold still for a moment to lift the fixture instead. In the room: tap a slot to buy or manage a machine or a
desk, long-press and drag a fixture to move it, tap a Hold Bay parcel for Toss / Clear, tap a locked loading dock to buy
it.

### Controls

| Touch             | Desktop                 | Does                                                                                                                              |
| ----------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| tap               | click                   | select a building (rush it), a vehicle, the warehouse, a hub, a locked region                                                     |
| double-tap        | double-click            | zoom 1× ⇄ 2× at that point; on a vehicle: follow it                                                                               |
| drag              | mouse drag / arrow keys | pan the city (with inertia); scroll the tall rooms at tiers 4–5                                                                   |
| swipe the chips   | mouse drag              | scroll the region chips above the bottom bar (`<` / `>` mark hidden chips)                                                        |
| pinch             | mouse wheel             | zoom 1× / 2× (in the warehouse the wheel scrolls a tall room)                                                                     |
| long-press        | right-click             | district panel (satisfaction, favours, waiting parcels, its quest)                                                                |
| HUD buttons       | `Space` / `1` / `2`     | pause / 1× / 2× (❚❚ while paused opens the pause menu)                                                                            |
| Warehouse, Garage | `W`, `G`                | switch views, open the Garage                                                                                                     |
| —                 | `Esc`, `F`              | close the top sheet or card (a decision or job card stays); follow the vehicle nearest the cursor                                 |
| —                 | `Enter`                 | confirm a dialog; a card's first option (never a red or greyed one); Accept the Golden Release; Run summary on the Game Over card |

On an event or job card `Esc` and a tap outside do nothing (the card waits for your choice; a news card closes on any
tap, `Esc` or `Enter`), and `Enter` takes the first option unless it is red or greyed.

Sound starts with the first tap anywhere on the Title; the sax button mutes. Switching apps pauses and saves. Portrait
only.

### Optional short sessions (after the cold run)

Both need `?debug=1` (it also shows the fps / draw-call overlay, allows 4× speed with key `4` and exposes `window.__pm`)
and each keeps its own save and profile, so the cold run's stay untouched:

- `?debug=1&config=spicy` loads `configs/spicy.json`: malware 9 % instead of 5 % at L1, decoys 30 % instead of 22 %, a
  Hold Bay of 2 at levels 1–2, and the cards at about twice the pace — the first at 1:00 (60 s instead of 3:20), then
  one every 30–60 s at L1–L2 and 40–70 s from L3 — so a Hold Bay stall, a lost-life card, a job card and a story show
  up within minutes.
- `?debug=1&config=tycoon` loads `configs/tycoon.json`: every New game starts at level 5 with the lane built (desk 1
  and desk 2 with two inspectors each, Metal detector, Shaky shaker, Battery checker, X-ray), the Sorter Arm in the
  Hold Bay station, docks 2–3, and 3 bikes, 2 vans and 3 trucks with their drivers, paid out of a $14,500 start; the
  Golden Release is on offer from the first minute. A short session for Victory and endless mode without the climb.

### Saves

Everything lives in `localStorage` on the page's origin; nothing is sent anywhere.

| Key                                                  | What                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `pm.save.v2`                                         | the autosave (every 10 s and when the tab hides); the Title offers **Continue** from it |
| `pm.settings.v1`                                     | mute and speed (shared by every session)                                                |
| `pm.playtest.v3`                                     | the playtest profile (the same object as `playtest.json`, version 3)                    |
| `pm.save.v2:cfg:<name>`, `pm.playtest.v3:cfg:<name>` | the save and profile of a `?config=<name>` session (`spicy`, `tycoon`)                  |

A save from another build (a playtest-1 `pm.save.v1`, or a `pm.save.v2` written with other data tables) is never
loaded: the Title says `Save from an older build was reset` and drops it. A build-2 profile (`pm.playtest.v2`) is never
resumed: build 3 starts a new v3 profile. Title → **Reset** clears all of these keys, every config's included, and a
leftover `pm.save.v1`, `pm.playtest.v2` or `pm.playtest.v1` (with their `:cfg:` copies). `?newGame=1` starts fresh
without the Title's Continue.

## How to serve on a phone

`dist/` is a static build: any web server works, plain http is fine (localStorage, WebGL and the sound-unlock tap all
work), there is no service worker. The hand-off zip (`vlr bundle` → `dist-zip/pm-tycoon-<sha>.zip`) unzips to a
`dist/` folder with a `playtest-README.txt`.

1. **Desktop devtools, iPhone 16 preset.** Serve `dist/` (path 2, or `vlr build && vlr preview -- --host` from a
   clone), open `http://localhost:4173/` in Chrome, devtools → device toolbar → **iPhone 16** (393 × 852, DPR 3; add
   it as a custom device if the list lacks it) and reload. At 393 × 852 the tier-4/5 rooms fit; to see the tall-room
   scroll add a custom device of 393 × 659 (Safari's viewport with its toolbars) or 360 × 604.
2. **iPhone from the zip, served on the Mac's LAN.** Unzip, then

   ```sh
   cd dist && python3 -m http.server 4173
   ```

   and open `http://<mac-lan-ip>:4173/` in Safari on the iPhone (same Wi-Fi; `ipconfig getifaddr en0` prints the
   address; allow python3's incoming connections if macOS asks).

3. **GitHub Pages.** The repository is `github.com/ruyadorno/pm-tycoon` with Pages set to "GitHub Actions" and a
   custom domain: the site is `https://ruyadorno.com/pm-tycoon/`. `.github/workflows/pages.yml` is manual on purpose:
   Actions → **Pages** → **Run workflow** (or `gh workflow run pages.yml`) builds, checks and deploys `main`; the build-2
   hand-off dispatches it once (Q-B2-9). Uncomment its `push` block to deploy on every push. `vite.config.ts` uses
   `base: './'`, so the same build works under `/pm-tycoon/`, and the atlases are content-hashed, so a redeploy never
   mixes old art with new code.
4. **SSH tunnel** — only if you have a route to the build VM: `vlr preview -- --host` there, then
   `ssh -g -L 4173:localhost:4173 <vm>` on the Mac and open `http://<mac-lan-ip>:4173/` on the phone.

Each origin (`localhost`, the LAN address, the Pages domain) keeps its own save and playtest profile.

## Develop

Needs Node ≥ 26 and vlt 1.6.x (`npm i -g vlt@1.6.0`); vlt is the only package manager used here.

```sh
vlt install
vlr dev -- --host                 # http://localhost:5173 (and the LAN address); __pm is always on in dev
vlr check                         # toolchain, typecheck, lint, fmt, vitest, art lint, quick sim gate, e2e smoke
vlr sim -- --minutes 30 --seed 7  # the headless sim with the competent policy, one row per in-game minute
vlr sim:gate                      # seeds 1-10 x 30 min against the pacing windows → docs/gate/latest.md
vlr sim:gate -- --minutes 35      # the same plus the Golden Release offer row
vlr sim:delegating                # the informational delegating policy (hires a sorter, Clears what it tags clean)
vlr fixtures                      # regenerate the saved sim states (tests/fixtures, src/assets/attract.json)
vlr e2e:install                   # once: Playwright's Chromium (no root); without it the e2e steps print SKIPPED
vlr shots                         # build + screenshots into shots/
vlr art:build                     # the offline art pipeline → src/assets/{world,interior}.{png,json} (+ logo.png)
vlr build                         # production build → dist/
node tools/check-dist.mjs         # transfer budget (≤ 8 MB without source maps), hashed atlases, samples, configs
vlr bundle                        # dist/ → dist-zip/pm-tycoon-<sha>.zip
```

Long commands (`vlr check`, `vlr shots`, `vlr sim:gate`, `vlr art:build`) take a minute or more. `vlr art:gen` needs
a `PIXELLAB_TOKEN` in a gitignored `.env`; without it the procedural art is used and the pipeline still runs.

URL parameters (`src/debug/params.ts`): `seed=N`, `skipTitle=1`, `newGame=1`, `mute=1`, `audio=0`, `audiolog=1`,
`attract=0` (the Title on a plain backdrop, no demo city), `view=city|warehouse`, `fastForward=S` (sim seconds before
the first frame), `policy=1` (the competent scripted player; `policy=delegating` for the delegating one); `debug=1`
installs `window.__pm`, the overlay and 4× speed, and enables `config=<name>` (`public/configs/<name>.json`),
`level=N` (a fresh game forced to level N), `quest=<id>` (offer that quest on a fresh game), `event=<id>` (open that
`src/data/events.json` card on a fresh game; `__pm.events()` shows the deck's state) and `view=gallery`.

## Documents

| File                       | What                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `AGENTS.md`                | rules for coding agents working in this repo (commands, commits, code rules)            |
| `docs/report-playtest3.md` | the build-3 end-of-run report: the cards, the deck the policy chose, the −10 % pass, G7 |
| `docs/report-playtest2.md` | the build-2 end-of-run report: what changed since playtest 1, art approvals, balance    |
| `docs/report-playtest1.md` | the playtest-1 report (levels 1–2)                                                      |
| `docs/status.md`           | one entry per milestone (M0–M4, M5–M10, then M11–M15)                                   |
| `docs/decisions.md`        | every default taken, run decision, retune and runtime dependency                        |
| `docs/gate/latest.md`      | the latest 10-seed sim gate table                                                       |
| `docs/playtest.md`         | how to read `playtest.json` (v3) and the fun bar 3                                      |
| `docs/feel-check-m12.md`   | a ten-minute phone session on the first build with the cards (M12)                      |
| `docs/phone-checklist.md`  | the iPhone 16 + desktop devtools checklist                                              |
| `docs/art-todo.md`         | the art awaiting the author's approval (G2–G7), the exact approve / reject commands     |
| `art/STYLE.md`             | the art contract (palette, grid, light, canvas classes)                                 |
| `tests/fixtures/README.md` | the saved sim states the screenshot specs load, and how to regenerate them              |
| `CREDITS.md`               | font, logo, art, audio and code credits with licences                                   |

The design documents (plans, mechanics specs, view specs, audio and style guides) live outside this repository.

## Licence

MIT (`LICENSE`). Third-party assets and libraries are listed in `CREDITS.md`; the instrument samples are CC-BY 3.0.
Nothing from Transport Tycoon or OpenTTD is used.
