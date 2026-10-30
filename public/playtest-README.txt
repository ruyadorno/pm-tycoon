Package Management Tycoon - playtest 1 build
=============================================

This folder is the whole game: a static web build (index.html, assets/,
audio/, configs/). It needs a web server (ES modules and fetch() do not
work from file://). Nothing is installed, and no service worker is used.
Plain http is fine: localStorage, WebGL and the sound-unlock tap all work.

The build stamp (short git sha + date) is shown on the Title screen.


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

Stop the server with Ctrl-C.


2. Play twenty minutes cold
---------------------------

  - Tap the Title (that tap also switches the sound on), then New game.
  - The 60-second tutorial: buy a bike in the Garage, watch the first
    delivery land, and when the first parcel is flagged, open the
    Warehouse and Toss it from the Hold Bay.
  - Play for twenty minutes without help: level 2, the Industrial district,
    the truck and the Shaky shaker all arrive after minute 10.
  - Then open the summary card: tap the pause button, then tap it again
    while paused to open the pause menu -> "End run - show summary".
    A ticker line also offers it at 20:00, and the Game Over card has a
    "Run summary" button.
  - On the card: "Download playtest.json" saves the run profile,
    "Copy summary" copies a plain-text version to paste into your notes.

  Controls: tap = pick / rush a building, double-tap = zoom 1x/2x (on a
  vehicle: follow it), drag = pan, pinch = zoom, long-press = district
  panel. Desktop: mouse drag, wheel zoom, right-click = long-press,
  Space pause, 1 / 2 speed, W warehouse, G garage, Esc close, arrows pan,
  F follow the vehicle nearest the cursor.


3. Optional: the short "spicy" session
--------------------------------------

    http://<host>:4173/?debug=1&config=spicy

  configs/spicy.json raises the malware and decoy shares and cuts the Hold
  Bay to 2, so a Hold Bay stall and the lost-life card show up within a
  few minutes. ?debug=1 also shows the fps/draw-call overlay, allows 4x
  speed (key 4) and exposes window.__pm in the console, e.g.
  __pm.playtest() for the live playtest object and __pm.downloadPlaytest().
  Use it after the cold run, not instead of it. It keeps its own save and
  playtest profile (keys ending in ":cfg:spicy", see 4), so the cold
  run's save and profile stay as they were; downloading the cold run's
  playtest.json first is still the safe habit.


4. Where the data lives
-----------------------

  localStorage on the page's origin (http://<host>:4173):
    pm.save.v2      the autosave (every 10 s and when the tab hides)
    pm.settings.v1  mute + speed
    pm.playtest.v1  the playtest profile (the same object as playtest.json)
  A ?config=<name> session (e.g. spicy) uses its own two keys:
    pm.save.v2:cfg:<name> and pm.playtest.v1:cfg:<name>
  (settings are shared). A build-1 save (pm.save.v1) is never loaded: the
  Title says "Save from an older build was reset" and removes it.
  Title -> Reset clears all of them: the save and profile of the cold run
  and of every config, the old pm.save.v1, and the settings. ?newGame=1
  starts fresh without the Title's Continue. A different port or host is a
  different origin: the save does not follow you between
  http://localhost and the LAN address.


5. Phone notes
--------------

  - Sound starts only after the first tap; the iPhone's Silent mode
    (Action button or Control Center) mutes it, on purpose. The sax
    button in the HUD mutes/unmutes.
  - Switching apps or locking the phone pauses and saves; tap the Paused
    card to resume.
  - Portrait only: landscape shows a "rotate" card.
  - The full checklist for the iPhone + devtools session is
    docs/phone-checklist.md in the repository; how to read playtest.json
    is docs/playtest.md.


Files
-----

  index.html, assets/*.js      the game (Phaser 4) - *.js.map are source
                               maps, fetched only when devtools are open
  assets/world-<hash>.png/.json, assets/interior-<hash>.png/.json
                               the two sprite atlases (+ m5x7-<hash>.xml
                               font, logo-<hash>.png, attract-<hash>.json)
  audio/sf/                    FluidR3_GM instrument samples, CC-BY 3.0
                               (audio/sf/LICENSE.txt)
  configs/spicy.json           the optional short-session data override
  gallery.html, gallery/       dev-only art review page, if present (not
                               part of the game)

Package Management Tycoon is MIT-licensed; credits are in CREDITS.md in
the repository (github.com/ruyadorno/pm-tycoon).
