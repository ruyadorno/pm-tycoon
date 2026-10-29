# Phone checklist (playtest 1)

The checks only a real device can answer (phaser4-notes.md "Install-time verification checklist", plan.md §6.11 and
§12.7 task 4), for one session on the **iPhone 16 (Safari)** and one in **desktop devtools mobile mode**. Serve the build
first (README "How to serve on a phone", or `playtest-README.txt` in the zip). Tick each line; a failed line names
the file to look at.

The automated side already passed on the VM: `e2e/smoke.spec.ts` (max texture ≥ 4096, `OES_standard_derivatives`,
`displayScale` = 1/zoom, m5x7 font, ≤ 8 draw calls, hit rects ≥ 44 px) and `e2e/dist.spec.ts` (the production build,
no `__pm` without `?debug=1`) — in headless Chromium, not Safari.

## iPhone 16, Safari

Open `http://<mac-lan-ip>:4173/` (portrait).

**Page and gestures** (`index.html` CSS, `src/input/GestureClassifier.ts`)

- [ ] No rubber-band: dragging the city hard up/down/left/right never pulls the page or shows Safari's grey
      overscroll background; pull-to-refresh never triggers.
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
      same money, fleet and day (autosave every 10 s and on hide).
- [ ] Title → Reset clears the save (the Title shows only New game / Reset / Credits).

**Performance** (plan.md §6.11; R4 cut order in `src/render/quality.ts`)

- [ ] Boot to Title under ~2 s on the Wi-Fi (first load; reloads are faster).
- [ ] City ⇄ Warehouse switches feel instant (< 150 ms).
- [ ] After the twenty-minute run, the summary card's **fps p50 · p5** row reads p50 ≥ 50 and p5 ≥ 30 (target: 60 at
      1× with three bikes and a truck, ≥ 45 at 2×). Below that, the profile's `fps` block is the evidence for the R4
      cut order.
- [ ] The phone does not get hot and the battery drain over twenty minutes is unremarkable.
- [ ] Optional, with `?debug=1`: the overlay's `dc` (draw calls) stays ≤ 8 and `fps` near 60 in the city with
      vehicles moving.

**The run** (docs/playtest.md)

- [ ] Played twenty minutes cold, then opened the summary card (❚❚, ❚❚ again → End run — show summary).
- [ ] **Download playtest.json** saved the file (Safari Downloads); **Copy summary** pasted into Notes.
- [ ] `playtest.json` → `device`: `cssW` 393, `dpr` 3, `zoom` 1, `maxTexture` ≥ 4096.

## Desktop devtools, iPhone 16 preset

Chrome: open `http://localhost:4173/?debug=1`, devtools → Toggle device toolbar (Cmd-Shift-M) → **iPhone 16** (if
the list lacks it: Edit… → Add custom device: 393 × 852, DPR 3, type Mobile, an iOS Safari user agent). Reload after
switching the preset (the canvas measures `#game` at boot).

- [ ] `__pm.game.scale.displayScale` prints `{x: 1, y: 1}` and `__pm.game.scale.zoom` prints `1` (a fractional or
      unequal value means `#game` was measured before layout — phaser4-notes.md §1, `src/main.ts`).
- [ ] `__pm.game.renderer.getMaxTextureSize()` ≥ 4096.
- [ ] The canvas is 393 CSS px wide and fills the viewport height (`100dvh`); no scrollbars.
- [ ] Touch emulation: drag pans with inertia, Shift-drag (pinch emulation) toggles the game zoom, a long-press opens
      the district panel; no page zoom or scroll.
- [ ] Rotate the emulated device: the rotate card appears; rotate back: the game resumes.
- [ ] Switch to another browser tab and back: the Paused card is up; a reload offers Continue.
- [ ] Console: no errors during a five-minute session (warnings are fine).
- [ ] Performance monitor (devtools → More tools → Performance monitor): JS heap stays under 150 MB over ten minutes;
      the overlay's `dc` stays ≤ 8.
- [ ] Desktop parity with the device toolbar **off** (430 px portrait column centred): mouse drag pans, wheel zooms,
      right-click opens the district panel, keys Space / 1 / 2 / W / G / Esc / arrows / F work.
- [ ] `__pm.playtest()` returns the live profile; its `device` block matches the preset (393, DPR 3, zoom 1).

Record anything unticked with the device, the URL and what you saw; screenshots (or a screen recording) help most for
the rubber-band, toolbar and audio items.
