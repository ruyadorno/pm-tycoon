Package Management Tycoon - playtest 3 build
=============================================

This folder is the whole game: a static web build (index.html, assets/,
audio/, configs/). It needs a web server (ES modules and fetch() do not
work from file://). Nothing is installed, and no service worker is used.
Plain http is fine: localStorage, WebGL and the sound-unlock tap all work.

The build stamp (short git sha + date) is shown on the Title screen.

The game: levels 1 to 5, hired people with stats and salaries, quests
with a golden parcel, the Docks and the Airport, a warehouse that grows
through five tiers, and the Golden Release that wins the game (then
endless mode). Build 3 adds event cards (every minute or two the clock
stops and a card asks you to decide something about the company; job
offers are cards too) and a climb about 10% shorter than build 2's.


1. Serve it from the Mac
------------------------

    cd dist                          (the folder this file is in)
    python3 -m http.server 4173

  Desktop:  open http://localhost:4173/ in Chrome or Safari, open devtools,
            switch on the device toolbar and pick the "iPhone 16" preset
            (393 x 852, DPR 3). Reload after switching the preset.
  iPhone:   same Wi-Fi as the Mac. Find the Mac's LAN address with
                ipconfig getifaddr en0
            then open http://<mac-lan-ip>:4173/ in Safari.
            (If macOS asks whether python3 may accept incoming network
            connections, allow it.)
  Online:   https://ruyadorno.com/pm-tycoon/ once the Pages workflow has
            deployed this build (the hand-off report says whether it did).

Stop the server with Ctrl-C.


2. Play thirty to forty minutes cold
------------------------------------

  - The Title is the logo over a live demo city. Tap anywhere (that tap
    also switches the sound on), then New game.
  - The tutorial: buy a bike in the Garage and pick its driver from three
    applicants, watch the first delivery land, and when the first parcel
    is flagged, open the Warehouse and Toss it from the Hold Bay.
  - Then play without help or debug flags. What to expect along the way
    (the scripted test player's times: the 10-seed sim gate's medians
    with the card deck on, in game time - the pauses on cards come on
    top; a cold human is usually later):
      3:20 (day 4) the first card; then one every 60-100 s of game time
                   at level 1 (a little less often at higher levels)
      ~10.7 min    level 2: Industrial, the truck, the Shaky shaker, and
                   a sorter for the Hold Bay station
      ~16.5 min    level 3: the Docks and the ship, overseas parcels,
                   a second desk, loading dock 2, the Battery checker
      ~20.6 min    level 4: two new districts, the X-ray, the Sorter Arm,
                   dock 3; the warehouse room grows (drag to scroll)
      ~25.3 min    level 5: the Airport and the civic park; the Golden
                   Release (60 deliveries in 5 days, no malware
                   delivered, 85% on time) wins the game
  - The cards: every card pauses the game until you choose (PAUSED in
    its corner; no timer, no Later). Under each option the card prints
    exactly what it does: costs in red, gains in green, "Can't afford"
    on a greyed option, "- this can end the run" on a red option that
    could take your last life, "...then: <next card> (in N days)" when a
    story continues. News cards have one OK (any tap closes them).
    Jobs come as JOB BOARD cards: Accept or Decline, no Later; the chip
    next to the level bar then shows the job's progress (tap it for
    Abandon). While a card's effect runs, a small effects chip with a
    count sits in the top bar: tap it (or "Effects" in the pause menu)
    for the list and the time each has left. The Golden Release is the
    one offer that is not an event card: its gold card does not pause
    the game and keeps Later.
  - At 30:00 of game time (never before 25 real minutes: fun bar item
    4 counts real minutes, and at 2x the game clock runs ahead) a ticker
    line and a toast offer the summary card. Open it then, or keep
    playing and open it later: tap the pause
    button, then tap it again while paused to open the pause menu ->
    "End run - show summary". The Game Over and Victory cards also have
    a "Run summary" button.
  - On the card: "Download playtest.json" saves the run profile,
    "Copy summary" copies a plain-text version to paste into your notes.
    Then note how it felt: was a hire a real choice, were the cards
    real choices and did they come too often or too rarely, did you want
    the next quest, did level 3 and the Docks feel like a new beat, and
    could you explain every lost life?

  Controls: tap = pick / rush a building, double-tap = zoom 1x/2x (on a
  vehicle: follow it), drag = pan (in a tall tier-4/5 warehouse room:
  scroll it), pinch = zoom, long-press = district panel. In the
  warehouse: tap a slot, the desk, the Hold Bay station or a loading
  dock for its card; long-press and drag a fixture to move it. Desktop:
  mouse drag, wheel zoom (wheel scrolls a tall room), right-click =
  long-press, Space pause, 1 / 2 speed, W warehouse, G garage, Esc
  close, Enter confirm, arrows pan, F follow the vehicle nearest the
  cursor. On an event or job card Esc and a tap outside do nothing;
  Enter takes the first option unless it is red or greyed.


3. Sending playtest.json back
-----------------------------

  iPhone:  "Download playtest.json" asks Safari to download it; it lands
           in Files -> Downloads (Safari's download list shows it too).
           Share it from there (AirDrop to the Mac, Mail or Messages)
           together with the "Copy summary" text and your notes.
  Desktop: the file goes to the browser's Downloads folder.
  Lost the card? The same profile stays in localStorage (see 5) until
  Title -> Reset or a New game; with ?debug=1, __pm.downloadPlaytest()
  in the console saves it again (Safari Web Inspector on the iPhone:
  Settings -> Apps -> Safari -> Advanced -> Web Inspector, then on the
  Mac Safari: Develop -> your iPhone -> the page).


4. Optional short sessions (after the cold run, not instead of it)
-------------------------------------------------------------------

    http://<host>:4173/?debug=1&config=spicy
    http://<host>:4173/?debug=1&config=tycoon

  configs/spicy.json: more malware (9% at level 1 instead of 5%) and
  decoys (30% instead of 22%), a Hold Bay of 2 at levels 1-2, and the
  cards at about twice the pace: the first at 1:00 (instead of 3:20),
  then one every 30-60 s (40-70 s from level 3), so a Hold Bay stall,
  the lost-life card, a job card and a story show up within a few
  minutes.

  configs/tycoon.json: every New game starts at level 5 with the lane
  built (two desks with two inspectors each, Metal detector, Shaky
  shaker, Battery checker, X-ray), the Sorter Arm, loading docks 2-3 and
  3 bikes, 2 vans and 3 trucks with drivers. The Golden Release is on
  offer from the start: a short session for Victory, the TYCOON card and
  endless mode.

  ?debug=1 also shows the fps/draw-call overlay, allows 4x speed (key 4)
  and exposes window.__pm in the console, e.g. __pm.playtest() for the
  live playtest object and __pm.downloadPlaytest(). Each config keeps its
  own save and playtest profile (keys ending in ":cfg:<name>", see 5),
  so the cold run's save and profile stay as they were; downloading the
  cold run's playtest.json first is still the safe habit.


5. Where the data lives
-----------------------

  localStorage on the page's origin (http://<host>:4173):
    pm.save.v2      the autosave (every 10 s and when the tab hides)
    pm.settings.v1  mute + speed
    pm.playtest.v2  the playtest profile (the same object as
                    playtest.json)
  A ?config=<name> session (spicy, tycoon) uses its own two keys:
    pm.save.v2:cfg:<name> and pm.playtest.v2:cfg:<name>
  (settings are shared). A save from another build (the playtest-1
  pm.save.v1, a build-2 save, or an older build-3 one) is never loaded:
  the Title says "Save from an older build was reset" and removes it.
  Title -> Reset clears all of them: the save and profile of the cold run
  and of every config, a leftover pm.save.v1 or pm.playtest.v1, and the
  settings.
  ?newGame=1 starts fresh without the Title's Continue. After a Victory
  the Title's Continue line ends with "Tycoon" and a check mark. A
  different port or host is a different origin: the save does not
  follow you between http://localhost and the LAN address.


6. Phone notes
--------------

  - Sound starts only after the first tap; the iPhone's Silent mode
    (Action button or Control Center) mutes it, on purpose. The sax
    button in the HUD mutes/unmutes. The demo city behind the Title is
    silent until that first tap.
  - Switching apps or locking the phone pauses and saves; tap the Paused
    card to resume.
  - Portrait only: landscape shows a "rotate" card.
  - At warehouse tiers 4-5 the room can be taller than the screen (tier
    5 is on an iPhone 16 in Safari, 393 x 659 with the toolbars; it fits
    on taller screens and in devtools' 393 x 852 preset - use a custom
    393 x 659 device there to see it): drag it up and down; the lane
    readout stays fixed above it.
  - The full checklist for the iPhone + devtools session is
    docs/phone-checklist.md in the repository; how to read playtest.json
    is docs/playtest.md.


Files
-----

  index.html, assets/*.js      the game (Phaser 4) - *.js.map are source
                               maps, fetched only when devtools are open
  assets/world-<hash>.png/.json, assets/interior-<hash>.png/.json
                               the two sprite atlases (+ m5x7-<hash>.xml
                               font, logo-<hash>.png, attract-<hash>.json
                               = the Title's demo city)
  audio/sf/                    FluidR3_GM instrument samples, CC-BY 3.0
                               (audio/sf/LICENSE.txt)
  configs/spicy.json,          the optional short-session data overrides
  configs/tycoon.json
  gallery.html, gallery/       dev-only art review page, if present (not
                               part of the game)

Package Management Tycoon is MIT-licensed; credits are in CREDITS.md in
the repository (github.com/ruyadorno/pm-tycoon). The logo is the
author's own art.
