# Feel check — M12 build (the cards on screen)

One page for a short phone session with the M12 build (plan-build3 §8.3 task 7). This run did **not** stop here:
part A of the build-3 prompt never ran, so M11 → M15 were built in one go (docs/decisions.md, "Run decisions
(build 3)"). The M12 zip is still worth ten minutes: it is the first build with the cards, and anything you note
can go into a follow-up deck pass. The final playtest-3 build (M15) has the full deck and the pacing pass 2.

## How to serve it

    unzip pm-tycoon-<sha>.zip && cd dist
    python3 -m http.server 4173

Open `http://<mac-lan-ip>:4173/` in Safari on the iPhone (same Wi-Fi; `ipconfig getifaddr en0` gives the address),
or `http://localhost:4173/` in desktop Chrome with the iPhone 16 device preset. `playtest-README.txt` in the zip
has the long version.

## What is in

- **The EventCard.** Every card **pauses the game** until you answer (the `PAUSED` pill; the ticker says PAUSED).
  Two or three options, each with its effects written out under the button — generated from the same data the
  game applies, so the card cannot promise something the game does not do. A greyed option says `Can't afford`.
  A red option can cost a life, a vehicle or a worker; at your last life it adds `— this can end the run`.
- **News cards** (one OK) close on any tap.
- **Job offers are cards** now (`JOB BOARD`, Accept / Decline, no Later). The gold Golden Release offer keeps its
  Later.
- **The deck so far:** 62 cards — 48 that can be drawn (40 of them at level 1) plus chain links and the rescue —
  across all 12 categories. Chains to try: **Protection** (the gang, from L2: Deny → hide the fleet or lose a bike →
  the price goes up → the raid), **An angel** (the investor), **Yarn Yard Express** (the rival, five cards), the
  **Safety audit** (passes or fails on your own catch rate two days later).
- **The effects chip** (a small bell in the top bar's second row) appears while a modifier runs; tap it for the
  Effects list (also in the pause menu). The quest chip shrinks to make room.
- **The first card** comes at about 3:20, then one every 60–100 s of game time at level 1.
- **The Victory art** and confetti: play to the Golden Release, or open `?config=tycoon` for a five-minute win.
- Debug: `?event=ev_crime_gang` offers a card on a fresh game; `?quest=rush_district` a job card.

## What to look at (write a line per question)

1. **The pause.** Does a card stopping the game feel right, or should news cards (one OK) not pause?
2. **Cadence.** Is a card every 60–100 s at level 1 busy in a good way, or spammy?
3. **Readability.** Can you read the effects lines at arm's length? Is two lines per option enough?
4. **Danger.** Is the red option red enough? Did any card that took a life or a vehicle feel unfair?
5. **The chips.** Do the bell chip and the shrunk quest chip read? After a permanent effect the bell stays for the
   rest of the run — is that fine or clutter?
6. **Any card** whose choice felt fake (one obvious answer) or whose text did not match what happened.

## Where to write notes

Reply with the notes in the next prompt (or a file next to this one). A note that changes a plan default is
recorded in docs/decisions.md under its Q-B3 number, as the part-B prompt describes.
