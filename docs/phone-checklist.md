# Phone checklist (playtest 3)

The checks only a real device can answer (phaser4-notes.md "Install-time verification checklist", plan.md §6.11,
plan-build2.md §8.7 and §9), for one session on the **iPhone 16 (Safari)** and one in **desktop devtools mobile
mode**. Serve the build first (README "How to serve on a phone", or `playtest-README.txt` in the zip). Tick each line;
a failed line names the file to look at. The playtest-1 lines are kept; the build-2 lines are marked **(B2)**, the
build-3 lines **(B3)**.

The automated side already passed on the VM, in headless Chromium (not Safari): `e2e/smoke.spec.ts` (max texture ≥
4096, `OES_standard_derivatives`, `displayScale` = 1/zoom, m5x7 font, ≤ 8 draw calls, hit rects ≥ 44 px, the logo over
the attract city, the Garage driver picker, the sorter, the tall rooms' scroll at L5), `e2e/quests.spec.ts` (the
golden parcel, the Golden Release and the VictoryCard), `e2e/events.spec.ts` (the event and job cards, the hold, the
modal stack, the effects chip and list), `e2e/lifecycle.spec.ts` (view storms, rotate and hide/show holds) and
`e2e/dist.spec.ts` (the production build, hashed assets, no `__pm` without `?debug=1`, `?config=` only with it).

Shortcuts for the lines that come late in a cold run (use them **after** the cold session; each keeps its own save,
see README "Saves"): `?debug=1&config=tycoon` starts at level 5 with a full lane, fleet and docks 2–3 (the tall tier-5
room, the plane, the Golden Release); `?debug=1&config=spicy` brings the first card at 1:00 (then one every 30–60 s), a
job card and a lost life within minutes; `?debug=1&event=ev_sec_recall` opens a danger card on a fresh game (`Take the
strike` is the red option; it costs a life).

## iPhone 16, Safari

Open `http://<mac-lan-ip>:4173/` (portrait).

**Title (B2)** (`src/scenes/TitleScene.ts`, `src/render/AttractCamera.ts`, B2 §5)

- [ ] The author's logo sits at the top, whole and centred, not cut by the Dynamic Island; at DPR 3 it is upscaled
      nearest-neighbour like the rest of the game (sharp pixel steps, no blur).
- [ ] Behind it the demo city moves: bikes, vans and trucks drive and deliver while the camera drifts from region to
      region (12-s legs with a short hold); no HUD, no cards, no toasts.
- [ ] Nothing plays before the first tap; that tap (anywhere) starts the music, and "tuning up…" disappears once the
      instruments are loaded. The demo city stays silent until then.
- [ ] The buttons (Continue when a save exists, New game, Reset, Credits) are each easy to hit; Credits opens a modal
      card that a tap closes.
- [ ] New game (or Continue) fades into the player's own city within about half a second and the HUD appears; the demo
      city never leaks into the save (Continue later shows your day and money, not the demo's).
- [ ] The Title feels smooth (no visible stutter while the city drifts); the build stamp is readable.

**Page and gestures** (`index.html` CSS, `src/input/GestureClassifier.ts`)

- [ ] No rubber-band: dragging the city hard up/down/left/right never pulls the page or shows Safari's grey
      overscroll background; pull-to-refresh never triggers. **(B2)** The same in a tall tier-4/5 warehouse room
      dragged past its top or bottom.
- [ ] No double-tap zoom: double-tapping a building zooms the **game camera** 1× ⇄ 2× (and rushes once), the page
      itself never zooms.
- [ ] No page pinch-zoom over the canvas: a pinch changes only the game zoom (discrete 1×/2×), never Safari's page zoom.
- [ ] No text-selection loupe, callout menu or grey tap highlight on a long-press (a long-press opens the district
      panel instead).
- [ ] Pixels are crisp: 1-px outlines on buildings and the m5x7 text are sharp, no blur or uneven pixel widths
      (`scale.displayScale` integer — see the devtools section for the exact reading).

**Layout** (`index.html` `#game { height: 100dvh }`, `src/main.ts` resize handler, `src/ui/layout.ts`)

- [ ] `100dvh` fills the screen: the game reaches the bottom edge behind Safari's (bottom) toolbar, no strip of page
      background below the HUD, and the HUD bottom bar is fully visible and tappable with the toolbar expanded and after
      it collapses on scroll.
- [ ] Safe areas: the top bar clears the Dynamic Island / status bar; the bottom bar clears the home indicator.
- [ ] Rotate to landscape: the "rotate" card appears and the sim pauses; back to portrait: the game resumes as it was.
- [ ] Every button is comfortably tappable (≥ 44 pt) and no two bottom-bar buttons are hit by one tap.
- [ ] **(B2)** With a quest active, the quest chip, the shortened level bar and the shield share the second top row
      without overlapping, and each one opens its own card or popover.
- [ ] **(B3)** With a quest active **and** an effect running, the effects chip sits between the level bar and the
      compact quest chip (its bar only, no time text); the level bar still reads, and each chip opens its own card.

**Hiring (B2)** (`src/ui/HireSheet.ts`, `src/scenes/GarageSheet.ts`, `src/ui/warehouse/SlotCard.ts`,
`src/ui/warehouse/StationCard.ts`, B2 §2)

- [ ] Garage → Bike opens `Who drives the Bike?` with three applicant cards side by side: face, name, pips (speed,
      energy, charisma) readable at 1×, `$N/day · fee $N`, a **Hire** button per card, then **Post an ad $30** and
      **Hire later**. The pick drives the new bike (toast `Bike 1 bought — <name> hired`).
- [ ] The desk card's **Hire inspector** opens the same sheet for inspectors (eye, pace, charisma); the cards differ in
      salary as their pips differ, and `New faces in m:ss` counts down to the daily refresh.
- [ ] Post an ad replaces the three cards (and charges $30); a refused hire (not enough money, a full desk) shakes the
      button with a reason instead of doing nothing.
- [ ] A Garage row's `···` opens Replace driver / Fire driver / Sell; Replace waits for the trip (`→ <name> after this
      trip`).
- [ ] From L2 a tap on the Hold Bay station (right of the rack) opens its card: **Hire a sorter**; once hired, the
      sorter stands at the podium, tosses on their own, and a held parcel's card reads `<name>: looks clean (NN%)`.
- [ ] A ★ applicant (a Clean sweep or Like clockwork reward) shows the gold star and `fee $0`.

**Cards (B3)** (`src/ui/EventCard.ts`, `src/ui/EventChip.ts`, `src/ui/EffectsCard.ts`, `src/ui/effectText.ts`, B3
§3.4)

- [ ] At 3:20 of game time (Day 4) the first card opens by itself, in the city or the warehouse: masthead (category
      word, `Day N`, the `PAUSED` pill), the 48 × 48 picture, the title, the story, then one full-width button per
      option with its effects line under it; nothing is cut off at 393 px and the text is readable at 1×.
- [ ] **The game is paused under it**: vehicles stop, the clock and the ticker freeze, the music plays on; the sim
      resumes the moment you pick an option. Another card follows about every 60–100 s of game time at L1.
- [ ] The effects lines read at a glance: costs in red, gains in green, the rest muted; a greyed option shows `Can't
      afford · $N` and does nothing when tapped (a shake and a tooltip); a red option reads as dangerous, and at one
      life its line ends `— this can end the run`.
- [ ] A double tap never decides the next card unread: tapping fast through one card does not land on the next one's
      buttons (a red option needs a slightly longer look).
- [ ] A tap outside a decision or job card does nothing; a one-option news card closes on any tap.
- [ ] A story reads as one: a follow-up card opens with `You chose: …`, and an option that continues one says `…then:
      <next card> (in N days)`.
- [ ] While an effect runs, the effects chip (the orange bell with a count) shows in the top bar; tap it → the Effects
      list (each effect, `1d 12h left` / `permanent`, the card that set it), and the pause menu (❚❚, ❚❚ again) has
      `Effects · N` opening the same list. The list does **not** pause the game: vehicles keep moving under it. When a
      card comes while a sheet is open (the Garage, a slot card), the game holds, the chip pulses, and the card opens
      when the sheet closes (or at once from a chip tap).
- [ ] **Danger cards**: the red option reads as the dangerous one at a glance (not just a different shade of the
      primary), and a quick tap the moment the card slides in does not take it. Pick `Take the strike` (the shortcut
      above, or a strike card in the run): the lives flash, the ticker reads `The recall cost a life — 2 lives left`,
      and the lost-life card shows the card's title, `You chose: Take the strike` and the lives left, with one OK. At
      the last life the line ends `— this can end the run`, and the Game Over card reads `The recall — you chose: Take
      the strike`.
- [ ] A story's last card ends with the paper `<the story's title> — the story ends`; the cards between read as one
      story (the same names, `You chose: …` at the top).
- [ ] With a card up, switch apps and come back: the same card, still paused (no Paused card over it — the card is the
      pause). Swipe Safari away with a card up and Continue from the Title: the card is back, held, and the clock has
      not moved.
- [ ] A card that opens in the warehouse looks the same as in the city, with the room frozen under it; after the
      choice, the next tap on the room (a Hold Bay parcel, a slot) lands normally.

**Quests (B2, jobs B3)** (`src/ui/EventCard.ts` for the offer, `src/ui/QuestCard.ts`, `src/ui/QuestChip.ts`,
`src/render/cityHub.ts`, B2 §3, B3 §3.1)

- [ ] A job offer is a JOB BOARD card like the others (it pauses the game): title, story, objective, `Reward: …` and the
      time limit in the effects line, and **Accept** · **Decline** — no Later — each easy to hit.
- [ ] After Accept the chip in the top bar shows the gold progress bar and the time left; a chip tap opens the quest
      card with **Abandon** (asks first) and **Close**.
- [ ] A Special delivery: the golden parcel and its markers over A and B are easy to spot at zoom 1, the 2:00
      countdown runs, and an on-time delivery lights a new life slot (`+1 life — 4 of 5`).
- [ ] QUEST COMPLETE: the gold stamp rises at the money cell, the sting plays, and the card's **OK** closes it.

**Levels 3–5 (B2)** (`src/scenes/CityScene.ts`, `src/scenes/WarehouseScene.ts`, `src/render/warehouse/RoomLayout.ts`,
B2 §4)

- [ ] Each level-up: the dust cloud over the warehouse, the new region's fog lifting, the newspaper, the NEW chip —
      at levels 4–5 the chips row scrolls by itself so the new chips and their NEW badges are on screen; a `>` / `<`
      at the row's ends marks chips past the edge, and a swipe on the row scrolls it.
- [ ] L3: an overseas delivery shows the clearance ring over the port office; on a clearance the ship sails out bow
      first and comes back later.
- [ ] L5: on an Airport clearance the plane taxis and climbs off the map; the ring sits over the terminal.
- [ ] Tier 4 (16 rows) and tier 5 (18 rows) rooms (in Safari with its toolbars the tier-5 room overflows by ~73 px,
      tier 4 by ~9 px; with the toolbars collapsed or on a Pro Max they may fit and not scroll): a vertical drag
      scrolls the room 1:1 with the finger (no page scroll, no inertia), the lane readout stays fixed above it, the bottom (shelf, bin) and the top (docks) are both
      reachable, and the finger lifting after a drag opens nothing.
- [ ] After scrolling, a tap still lands on the slot under the finger (slot 6 at tier 5); a long-press without moving
      still lifts a fixture to move it; a drag released over a HUD bar leaves nothing stuck (the next tap is a tap).
- [ ] A lost life at a hub reads `Handed off at <pier> 14:02` then `Cleared 14:47 — the ship has sailed` (`— the
      plane has left` at the Airport), and the lines fit the card at 393 px.

**Victory and Tycoon ✓ (B2)** (`src/ui/VictoryCard.ts`, `src/boot/autosave.ts`, B2 §3.4)

- [ ] The Golden Release offer has a gold frame and only Accept / Later (**(B3)** the one offer that is not an event
      card: it does not pause the game, and Later keeps it waiting); once accepted its chip reads `41/60` on the bar and
      `0✕ 94%` beside it (malware delivered, on-time rate), both glyphs drawn, not boxes.
- [ ] Shipping it pauses on the **TYCOON** card: the stats fit at 393 px, Continue / New game / Run summary tappable.
- [ ] After Continue the level bar reads `$… · Tycoon ✓` and, back on the Title (reload), the Continue line reads
      `Day N · $… · Lv 5 · Tycoon ✓` — the ✓ is a real glyph, not a box or a question mark.

**Sound** (`src/audio/director.ts`, audio.md §3)

- [ ] Nothing plays on the Title before the first tap.
- [ ] The Title tap starts the music within about a second ("♪ Now playing: Semver Swing" toast), and SFX follow
      taps and purchases.
- [ ] Silent mode (iPhone 16: the Action button or Control Center's bell) mutes the game entirely; turning it off
      brings the sound back. This is on purpose: the game respects the ringer setting.
- [ ] The HUD sax button mutes/unmutes, and the choice survives a reload (`pm.settings.v1`).
- [ ] After a phone call, Siri or a notification sound, the music comes back after the next tap.

**Backgrounding and saves** (`src/boot/autosave.ts`, `src/ui/PausedCard.ts`)

- [ ] Switch to another app (or lock the phone) mid-game, come back: the **Paused — tap to resume** card is up, the
      clock did not run while away, the tap resumes the sim and the music.
- [ ] Swipe Safari away entirely (or reload) and reopen the URL: the Title offers **Continue**, and it resumes the
      same money, fleet, staff, quest and day (autosave every 10 s and on hide).
- [ ] Title → Reset clears the save (the Title shows only New game / Reset / Credits).

**Performance** (plan.md §6.11; R4 cut order in `src/render/quality.ts`; plan-build2 §8.8 R14)

- [ ] Boot to Title under ~2 s on the Wi-Fi (first load; reloads are faster).
- [ ] City ⇄ Warehouse switches feel instant (< 150 ms), at every tier.
- [ ] After the thirty-to-forty-minute run, the summary card's **fps p50 · p5** row reads p50 ≥ 50 and p5 ≥ 30
      (target: 60 at 1× with the L3+ fleet, ≥ 45 at 2×). Below that, the profile's `fps` block is the evidence for the
      R4 cut order.
- [ ] **(B2)** The attract Title does not stutter or heat the phone while it sits for a minute (R14: its fps is not in
      `playtest.json`; the devtools section reads it).
- [ ] The phone does not get hot and the battery drain over the session is unremarkable.
- [ ] Optional, with `?debug=1`: the overlay's `dc` (draw calls) stays ≤ 8 in the city with vehicles moving and in the
      warehouse at every tier (measured on the VM with the overlay hidden: city 3, warehouse 4 — tier 5 with the tycoon
      lane too, 6 while a dock's loading bar shows; the overlay itself adds 1, and an open card or sheet adds its own
      camera's), and `fps` stays near 60.

**The run** (docs/playtest.md)

- [ ] Played thirty to forty minutes cold, answering the cards as you liked, then opened the summary card (offered at
      30:00 of game time, once 25 real minutes have passed; or ❚❚, ❚❚ again → End run — show summary).
- [ ] **(B3)** The card fits at 393 px with its four buttons visible: the rows include `Cards`, `Stories` and `Longest
      quiet`, `Lives lost` adds `· N by a card` when a card took one (its sub row reads `chose: <option>`), and the
      **Fun bar 3** block lists seven checks.
- [ ] **Download playtest.json** saved the file (Files → Downloads); **Copy summary** pasted into Notes; both sent back
      (AirDrop / Mail).
- [ ] `playtest.json` → `device`: `cssW` 393, `dpr` 3, `zoom` 1, `maxTexture` ≥ 4096; `version` 3, with an `events`
      block (your choices) and `beats`.

## Desktop devtools, iPhone 16 preset

Chrome: open `http://localhost:4173/?debug=1`, devtools → Toggle device toolbar (Cmd-Shift-M) → **iPhone 16** (if
the list lacks it: Edit… → Add custom device: 393 × 852, DPR 3, type Mobile, an iOS Safari user agent). Reload after
switching the preset (the canvas measures `#game` at boot).

- [ ] `__pm.game.scale.displayScale` prints `{x: 1, y: 1}` and `__pm.game.scale.zoom` prints `1` (a fractional or
      unequal value means `#game` was measured before layout — phaser4-notes.md §1, `src/main.ts`).
- [ ] `__pm.game.renderer.getMaxTextureSize()` ≥ 4096.
- [ ] The canvas is 393 CSS px wide and fills the viewport height (`100dvh`); no scrollbars.
- [ ] **(B2)** On the Title, before any tap: `__pm.game.loop.actualFps` reads ≥ 50 a few times over ten seconds (R14
      trigger: below 50), and `__pm.attractSim` is an object; after New game, `__pm.attractSim` is `null`.
- [ ] Touch emulation: drag pans with inertia, Shift-drag (pinch emulation) toggles the game zoom, a long-press opens
      the district panel; no page zoom or scroll.
- [ ] **(B2)** `?debug=1&config=tycoon` → New game → Warehouse, on a custom device of **393 × 659** (Safari's iPhone 16
      viewport with its toolbars; or 360 × 604) — at 393 × 852 the tier-5 room fits and does not scroll: the room
      scrolls with a touch drag and with the mouse wheel (32 px a notch), the readout stays put, and `__pm.quests()`
      shows the Golden Release offered.
- [ ] Rotate the emulated device: the rotate card appears; rotate back: the game resumes.
- [ ] Switch to another browser tab and back: the Paused card is up; a reload offers Continue.
- [ ] Console: no errors during a five-minute session (warnings are fine).
- [ ] Performance monitor (devtools → More tools → Performance monitor): JS heap stays under 150 MB over ten minutes;
      the overlay's `dc` stays ≤ 8.
- [ ] Desktop parity with the device toolbar **off** (430 px portrait column centred): mouse drag pans, wheel zooms,
      right-click opens the district panel, keys Space / 1 / 2 / W / G / Esc / Enter / arrows / F work; the hire sheet,
      quest card, event card and TYCOON card are centred in the column.
- [ ] **(B3)** On an event card `Enter` takes the first option (on a red or greyed first option it shows `Tap an
      option` instead), `Esc` does nothing on a decision or job card, and `Esc` or `Enter` closes a news card;
      `?event=<id>` opens that card on a fresh game and `__pm.events()` shows the deck's state.
- [ ] `__pm.playtest()` returns the live profile; its `device` block matches the preset (393, DPR 3, zoom 1), and
      `localStorage['pm.playtest.v3']` holds the same run. **(B3)** Leave a card up for about ten seconds, then pick
      an option: the new `__pm.playtest().events.choices` entry has `thinkS` ≈ 10 (wall seconds on screen); a card that
      waited behind the Garage counts only from when it showed.
- [ ] **(B3)** On a custom device of **360 × 604**: a three-option card (e.g. `?debug=1&event=ev_sec_crate`) fits above
      the bottom bar and the summary card fits the screen, every button inside the canvas.

Record anything unticked with the device, the URL and what you saw; screenshots (or a screen recording) help most for
the rubber-band, toolbar, tall-room scroll and audio items.
