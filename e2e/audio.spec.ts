// Audio live spec (audio.md §9.4, plan.md §11 / §12.6 task 11): the
// AudioDirector integrated in the real game, in Playwright's Chromium (the
// Web Audio graph runs with no output device, so nothing needs speakers).
//
// Headless Chromium starts every AudioContext 'running' whatever
// --autoplay-policy says (.logs/handoff/audio.md, open issues), so "ctx is
// suspended before the tap" cannot be observed here. The director's stronger
// guarantee is asserted instead: before the Title tap it is not unlocked, the
// Transport is stopped, no note is logged and every SFX is dropped as
// 'locked' (and not counted in `dropped`).
//
//   1. Title → tap "New game": the Transport starts at bar 0, first bass F2
//      (midi 41) on beat 0, the first piano voicing is Fmaj7 (A C E G), ≥ 20
//      notes after 2.5 s, 126 BPM, "Now playing" fired, dropped 0; one
//      AudioContext for the whole page; the director's boot cost is logged.
//      life:lost (a real one: sim.debug.forceMalwareDelivery) → the Transport
//      goes paused → started within 700 ms with tapeStop + thump, and keeps
//      playing under the lost-life card (Q47). game:over → stopped + the minor
//      tag (three piano2 chords + bass2 F1). Game-over card "New game" → Title
//      → "New game": the music restarts from bar 0.
//   2. Tab hide (Phaser HIDDEN, the loop asleep as in a hidden tab) pauses
//      the band and suspends the context; VISIBLE plays nothing (Phaser may
//      resume the silent context; the band waits); the HUD's Paused-card tap
//      resumes the band. The
//      HUD sax button mutes (master gain only: the Transport keeps running)
//      and persists pm.settings.v1.muted.
//   3. ?skipTitle=1: locked until the first gesture anywhere, then
//      'audio:unlocked' and the music; a Sim swap (__pm.load) moves the sim
//      subscription to the new Sim (the old one no longer sounds).
//   4. ?audio=0: a disabled director (still at __pm.audio), no AudioContext,
//      no sample fetch, the game runs.
// Build 2 (B2 §5): the Title runs over the attract city; the director never
// attaches to the attract sim, so "nothing sounds before the tap" also
// covers the demo fleet's deliveries (titleUp waits for the tour to run).
import type { Page } from '@playwright/test'
import {
  expect,
  READY_TIMEOUT_MS,
  test,
  titleUp,
  type PmHelpers,
} from './fixtures.ts'
import { sceneTarget } from './warehouse.ts'

const TITLE_URL = '/?seed=7&debug=1&audiolog=1'
const SKIP_URL = '/?seed=7&debug=1&skipTitle=1&mute=1'
const OFF_URL = '/?seed=7&debug=1&skipTitle=1&audio=0'
/** src/scenes/BootScene.ts AUDIO_{IMPORT,WAIT,CREATE}_MEASURE. */
const IMPORT_MEASURE = 'pm:audio:import'
const WAIT_MEASURE = 'pm:audio:wait'
const CREATE_MEASURE = 'pm:audio:create'
/**
 * Bound on the director's construction inside Boot (the bus graph; the zzfx
 * renders run afterwards). ~5 ms here; generous for a loaded VM.
 */
const MAX_CREATE_MS = 50
const SETTINGS_KEY = 'pm.settings.v1'

/** Counts every AudioContext the page constructs (before any module runs). */
async function countContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      pmCtxCount: number
      AudioContext: typeof AudioContext
    }
    w.pmCtxCount = 0
    const Orig = w.AudioContext
    if (!Orig) return
    w.AudioContext = class extends Orig {
      constructor(opts?: AudioContextOptions) {
        super(opts)
        w.pmCtxCount++
      }
    }
  })
}

function ctxCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { pmCtxCount: number }).pmCtxCount,
  )
}

/** Records the audio:* game events from now on (window.pmAudioEvents). */
function recordAudioEvents(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as {
      pmAudioEvents: { name: string; payload: unknown }[]
    }
    w.pmAudioEvents = []
    for (const name of [
      'audio:ready',
      'audio:muted',
      'audio:nowPlaying',
      'audio:unlocked',
    ])
      window.__pm!.game.events.on(name, (payload: unknown) =>
        w.pmAudioEvents.push({ name, payload }),
      )
  })
}

function audioEvents(
  page: Page,
  name: string,
): Promise<{ name: string; payload: unknown }[]> {
  return page.evaluate(
    (n) =>
      (
        window as unknown as {
          pmAudioEvents?: { name: string; payload: unknown }[]
        }
      ).pmAudioEvents?.filter((e) => e.name === n) ?? [],
    name,
  )
}

/** __pm and the director exist (Boot done) and scene `key` is active. */
async function sceneUp(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const pm = window.__pm
      return !!pm?.audio && pm.game.scene.isActive(k)
    },
    key,
    { timeout: READY_TIMEOUT_MS },
  )
}

/** Wait until scene `key`'s button `id` is live, then tap it for real. */
async function tapButton(
  page: Page,
  pm: PmHelpers,
  key: string,
  id: string,
): Promise<void> {
  await expect
    .poll(() => sceneTarget(page, key, id), { timeout: 15_000 })
    .not.toBeNull()
  const r = (await sceneTarget(page, key, id))!
  await pm.tap(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2))
}

function transportState(page: Page): Promise<string> {
  return page.evaluate(() => window.__pm!.audio!.state().transport.state)
}

async function waitTransport(page: Page, state: string): Promise<void> {
  await page.waitForFunction(
    (s) => window.__pm!.audio!.state().transport.state === s,
    state,
    { timeout: 15_000 },
  )
}

/** Samples transport.state every 25 ms for `ms` after running `action`. */
function sampleTransport(
  page: Page,
  action: 'forceMalwareDelivery',
  ms: number,
): Promise<{ seen: [number, string][]; sfx: string[]; lives: number }> {
  return page.evaluate(
    async ([act, dur]) => {
      const api = window.__pm!
      const a = api.audio!
      a.log.clear()
      api.sim.debug![act as 'forceMalwareDelivery']()
      const seen: [number, string][] = []
      const t0 = performance.now()
      while (performance.now() - t0 < (dur as number)) {
        seen.push([
          Math.round(performance.now() - t0),
          a.state().transport.state,
        ])
        await new Promise((r) => setTimeout(r, 25))
      }
      return {
        seen,
        sfx: a.log.sfxEntries().map((e) => e.sfx + (e.dropped ? '!' : '')),
        lives: api.sim.lives,
      }
    },
    [action, ms] as const,
  )
}

test.describe('audio (audio.md §9.4)', () => {
  test('nothing sounds before the Title tap; the tap starts the band; tape-stop, minor tag, New game', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    test.setTimeout(180_000)
    await countContexts(page)
    await page.goto(TITLE_URL)
    await sceneUp(page, 'Title')
    await titleUp(page)
    await recordAudioEvents(page)

    await test.step('Title: "tuning up…" goes once piano + bass are decoded', async () => {
      await page.waitForFunction(
        () => {
          const l = window.__pm!.audio!.state().loaded
          return l.piano && l.bass
        },
        null,
        { timeout: 20_000 },
      )
      const tuning = await page.evaluate(() => {
        const t = window
          .__pm!.game.scene.getScene('Title')
          .children.list.find((o) => o.getData?.('id') === 'title:tuning') as
          | { visible: boolean }
          | undefined
        return t ? t.visible : null
      })
      // null: piano + bass were decoded before the Title was built
      expect(tuning === null || tuning === false).toBe(true)
    })

    await test.step('before the tap: locked, Transport stopped, SFX dropped as locked', async () => {
      const pre = await page.evaluate(() => {
        const api = window.__pm!
        const a = api.audio!
        api.game.events.emit('ui:tap', { id: 'e2e' })
        api.game.events.emit('ui:sheetOpen', { id: 'e2e' })
        const played = a.sfx('buy')
        const st = a.state()
        return {
          played,
          ctxState: st.ctxState,
          disabled: st.disabled,
          unlocked: st.unlocked,
          transport: st.transport.state,
          notes: a.log.notes().length,
          sfx: a.log.sfxEntries().map((e) => `${e.sfx}:${e.dropped ?? ''}`),
          dropped: st.dropped,
          errors: st.errors,
        }
      })
      console.log(
        `audio: before the tap ctx=${pre.ctxState} (headless Chromium starts contexts running) ` +
          `unlocked=${pre.unlocked} transport=${pre.transport} sfx=${pre.sfx.join(',')}`,
      )
      expect(pre.disabled).toBe(false)
      expect(pre.unlocked).toBe(false)
      expect(pre.transport).toBe('stopped')
      expect(pre.notes).toBe(0)
      expect(pre.played).toBe(false)
      expect(pre.sfx).toEqual(['tap:locked', 'sheetOpen:locked', 'buy:locked'])
      expect(pre.dropped).toBe(0)
      expect(pre.errors).toEqual([])
      expect(await ctxCount(page)).toBe(1)
    })

    await test.step('director boot cost', async () => {
      // the 18 zzfx buffers render after boot, one per macrotask
      await page.waitForFunction(
        () => window.__pm!.audio!.director.sfx.pending().length === 0,
      )
      const cost = await page.evaluate(
        (names) => {
          const [i, w, c] = names.map(
            (n) => performance.getEntriesByName(n)[0]?.duration ?? -1,
          )
          return {
            importMs: i!,
            waitMs: w!,
            createMs: c!,
            sfxRenderMs: window.__pm!.audio!.state().sfxRenderMs,
          }
        },
        [IMPORT_MEASURE, WAIT_MEASURE, CREATE_MEASURE],
      )
      const text =
        `audio chunk import ${cost.importMs.toFixed(1)} ms (from main.ts, parallel with Phaser's boot), ` +
        `Boot waited ${cost.waitMs.toFixed(1)} ms for it, ` +
        `createAudioDirector ${cost.createMs.toFixed(1)} ms, ` +
        `18 zzfx renders ${cost.sfxRenderMs} ms in total (after boot, one per macrotask)`
      console.log(`audio: ${text}`)
      test
        .info()
        .annotations.push({ type: 'audio boot cost', description: text })
      expect(cost.importMs).toBeGreaterThan(0)
      expect(cost.waitMs).toBeGreaterThanOrEqual(0)
      expect(cost.createMs).toBeGreaterThan(0)
      expect(cost.createMs).toBeLessThan(MAX_CREATE_MS)
    })

    await test.step('tap "New game": the Transport runs from bar 0', async () => {
      await tapButton(page, pm, 'Title', 'title:new-game')
      await waitTransport(page, 'started')
      await pm.ready()
      await page.waitForTimeout(2500) // the Transport runs on the audio clock
      const s = await page.evaluate(() => {
        const a = window.__pm!.audio!
        const notes = a.log.notes()
        const bass = notes.find((n) => n.part === 'bass')
        const piano = notes
          .filter((n) => n.part === 'piano' && n.bar === 0 && n.beat === 0)
          .map((n) => n.midi % 12)
          .toSorted((x, y) => x - y)
        const st = a.state()
        return {
          st,
          n: notes.length,
          bass: bass
            ? { bar: bass.bar, beat: bass.beat, midi: bass.midi }
            : null,
          piano,
          tap: a.log.sfxEntries().filter((e) => e.sfx === 'tap' && !e.dropped)
            .length,
        }
      })
      console.log(
        `audio: after the tap ${s.n} notes, transport ${s.st.transport.position} @ ${s.st.transport.bpm} BPM, ` +
          `scheduled ${s.st.scheduled} skipped ${s.st.skipped} dropped ${s.st.dropped}`,
      )
      expect(s.st.unlocked).toBe(true)
      expect(s.st.ctxState).toBe('running')
      expect(s.st.loaded.piano && s.st.loaded.bass).toBe(true)
      expect(s.st.transport.bpm).toBe(126)
      expect(s.n).toBeGreaterThanOrEqual(20)
      expect(s.bass).toEqual({ bar: 0, beat: 0, midi: 41 })
      expect(s.piano, 'first piano voicing = Fmaj7 (A C E G)').toEqual([
        0, 4, 7, 9,
      ])
      expect(s.st.dropped).toBe(0)
      expect(s.st.errors).toEqual([])
      expect(s.st.nowPlaying).toBe('Semver Swing')
      expect(s.tap, 'the New game tap itself sounded').toBeGreaterThanOrEqual(1)
      const now = await audioEvents(page, 'audio:nowPlaying')
      expect(now.map((e) => (e.payload as { title: string }).title)).toContain(
        'Semver Swing',
      )
      expect(await audioEvents(page, 'audio:unlocked')).toHaveLength(1)
    })

    await test.step('life:lost: one-beat tape-stop, then the band plays on under the card', async () => {
      const tape = await sampleTransport(page, 'forceMalwareDelivery', 900)
      const paused = tape.seen.find(([, st]) => st === 'paused')
      const back = tape.seen.find(
        ([t, st]) => st === 'started' && !!paused && t > paused[0],
      )
      console.log(
        `audio: life:lost paused@${paused?.[0]} started@${back?.[0]} sfx ${tape.sfx.join(',')}`,
      )
      expect(tape.lives).toBe(2)
      expect(paused, 'transport paused').toBeTruthy()
      expect(back, 'transport started again').toBeTruthy()
      expect(back![0]).toBeLessThanOrEqual(700)
      expect(tape.sfx).toContain('tapeStop')
      expect(tape.sfx).toContain('thump')
      // Q47: the lost-life card holds the sim, the music keeps going
      await page.waitForTimeout(300)
      expect(await transportState(page)).toBe('started')
    })

    await test.step('game:over: the music stops and the minor tag plays', async () => {
      const go = await page.evaluate(async () => {
        const api = window.__pm!
        const a = api.audio!
        api.sim.debug!.forceMalwareDelivery() // 1 life left
        a.log.clear()
        api.sim.debug!.forceMalwareDelivery() // game over
        await new Promise((r) => setTimeout(r, 1000))
        const st = a.state()
        return {
          over: api.sim.gameOver,
          transport: st.transport.state,
          chords: a.log.notes('piano2').map((n) => (n.chord ?? []).join('/')),
          bass2: a.log.notes('bass2').map((n) => n.midi),
          dropped: st.dropped,
        }
      })
      console.log(`audio: game over ${JSON.stringify(go)}`)
      expect(go.over).toBe(true)
      expect(go.transport).toBe('stopped')
      expect(go.chords).toEqual(['53/56/60/63', '46/49/53/56', '41/48/56/64'])
      expect(go.bass2).toContain(29)
      expect(go.dropped).toBe(0)
    })

    await test.step('game-over card "New game" → Title → "New game": the music restarts from bar 0', async () => {
      await tapButton(page, pm, 'HUD', 'gameOver:newGame')
      await sceneUp(page, 'Title')
      await titleUp(page)
      expect(await transportState(page)).toBe('stopped')
      await page.evaluate(() => window.__pm!.audio!.log.clear())
      await tapButton(page, pm, 'Title', 'title:new-game')
      await waitTransport(page, 'started')
      await page.waitForTimeout(600)
      const re = await page.evaluate(() => {
        const a = window.__pm!.audio!
        const bass = a.log.notes('bass')[0]
        return {
          bass: bass
            ? { bar: bass.bar, beat: bass.beat, midi: bass.midi }
            : null,
          lives: window.__pm!.sim.lives,
          dropped: a.state().dropped,
        }
      })
      expect(re.lives).toBe(3)
      expect(re.bass).toEqual({ bar: 0, beat: 0, midi: 41 })
      expect(re.dropped).toBe(0)
      expect(await ctxCount(page)).toBe(1)
    })

    expect(consoleErrors).toEqual([])
  })

  test('tab hide pauses + suspends; the Paused-card tap resumes; the sax button mutes and persists', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    test.setTimeout(120_000)
    await page.goto('/?seed=7&debug=1')
    await sceneUp(page, 'Title')
    await titleUp(page)
    await page.waitForFunction(
      () => window.__pm!.audio!.state().loaded.piano,
      null,
      { timeout: 20_000 },
    )
    await tapButton(page, pm, 'Title', 'title:new-game')
    await waitTransport(page, 'started')
    await pm.ready()

    await test.step('HIDDEN → band paused, context suspended; VISIBLE plays nothing', async () => {
      // A hidden tab gets no rAF: freeze() puts Phaser's loop to sleep the
      // same way (Game.onHidden's loop.pause() only records a timestamp, and
      // Phaser's WebAudioSoundManager.update resumes a suspended context on
      // every frame while focused — its iOS 17/18 workaround).
      const vis = await page.evaluate(async () => {
        const api = window.__pm!
        const a = api.audio!
        api.freeze()
        api.game.events.emit('hidden')
        await new Promise((r) => setTimeout(r, 200))
        const hid = a.state()
        api.thaw()
        api.game.events.emit('visible')
        await new Promise((r) => setTimeout(r, 300))
        const back = a.state()
        return {
          hidden: [hid.transport.state, hid.ctxState, hid.hidden],
          visible: [back.transport.state, back.hidden],
          visibleCtx: back.ctxState,
        }
      })
      console.log(
        `audio: hidden ${vis.hidden.join(',')}; visible ${vis.visible.join(',')} ` +
          `(ctx ${vis.visibleCtx}: Phaser resumes a silent context on VISIBLE; the band waits for the tap)`,
      )
      expect(vis.hidden).toEqual(['paused', 'suspended', true])
      expect(vis.visible).toEqual(['paused', true])
    })

    await test.step('the Paused-card tap resumes the context and the band', async () => {
      const { width, height } = await page.evaluate(() => ({
        width: window.__pm!.game.scale.width,
        height: window.__pm!.game.scale.height,
      }))
      await pm.tap(Math.floor(width / 2), Math.floor(height / 2))
      await waitTransport(page, 'started')
      const st = await page.evaluate(() => window.__pm!.audio!.state())
      expect(st.ctxState).toBe('running')
      expect(st.hidden).toBe(false)
      expect(st.errors).toEqual([])
    })

    await test.step('HUD sax button: mute (Transport keeps running), persisted; unmute', async () => {
      await tapButton(page, pm, 'HUD', 'mute')
      await expect
        .poll(() => page.evaluate(() => window.__pm!.audio!.state().muted))
        .toBe(true)
      const saved = await page.evaluate(
        (k) =>
          JSON.parse(localStorage.getItem(k) ?? '{}') as { muted?: boolean },
        SETTINGS_KEY,
      )
      expect(saved.muted).toBe(true)
      expect(await transportState(page)).toBe('started')
      await tapButton(page, pm, 'HUD', 'mute')
      await expect
        .poll(() => page.evaluate(() => window.__pm!.audio!.state().muted))
        .toBe(false)
    })

    expect(consoleErrors).toEqual([])
  })

  test('?skipTitle=1: locked until the first gesture; a Sim swap re-attaches the sim events', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    test.setTimeout(120_000)
    await countContexts(page)
    await pm.open(SKIP_URL)
    await recordAudioEvents(page)
    const pre = await page.evaluate(() => {
      const a = window.__pm!.audio!
      const st = a.state()
      return {
        unlocked: st.unlocked,
        muted: st.muted,
        transport: st.transport.state,
        tap: a.sfx('tap'),
      }
    })
    expect(pre).toEqual({
      unlocked: false,
      muted: true, // ?mute=1
      transport: 'stopped',
      tap: false,
    })
    // ?mute=1 never writes the setting
    expect(
      await page.evaluate((k) => localStorage.getItem(k), SETTINGS_KEY),
    ).toBeNull()

    // A tap on the map (no button): the first gesture anywhere unlocks.
    const { width, height } = await page.evaluate(() => ({
      width: window.__pm!.game.scale.width,
      height: window.__pm!.game.scale.height,
    }))
    await pm.tap(Math.floor(width / 2), Math.floor(height / 2))
    await waitTransport(page, 'started')
    await expect
      .poll(async () => (await audioEvents(page, 'audio:unlocked')).length)
      .toBe(1)

    // Real sim events with full payloads (a debug malware delivery =
    // life:lost → tapeStop + thump), first on the replaced Sim, then on the
    // installed one.
    const swap = await page.evaluate(() => {
      const api = window.__pm!
      const a = api.audio!
      const old = api.core
      api.load(api.snapshot())
      const fresh = api.core
      a.log.clear()
      old.dispatch({ kind: 'debugMalwareDelivery' })
      const fromOld = a.log.sfxEntries().map((e) => e.sfx)
      api.sim.debug!.forceMalwareDelivery()
      const fromNew = a.log.sfxEntries().map((e) => e.sfx)
      return {
        replaced: old !== fresh,
        oldLives: old.state.economy.lives,
        fromOld,
        fromNew,
      }
    })
    expect(swap.replaced).toBe(true)
    expect(swap.oldLives, 'the old Sim did lose a life').toBe(2)
    expect(swap.fromOld, 'the old Sim no longer reaches the director').toEqual(
      [],
    )
    expect(swap.fromNew).toContain('tapeStop')
    expect(swap.fromNew).toContain('thump')
    expect(await ctxCount(page)).toBe(1)
    expect(consoleErrors).toEqual([])
  })

  test('?audio=0: a disabled director, no AudioContext, no sample fetch', async ({
    page,
    pm,
    consoleErrors,
  }) => {
    await countContexts(page)
    const sf: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/audio/sf/')) sf.push(r.url())
    })
    await pm.open(OFF_URL)
    const { width, height } = await page.evaluate(() => ({
      width: window.__pm!.game.scale.width,
      height: window.__pm!.game.scale.height,
    }))
    await pm.tap(Math.floor(width / 2), Math.floor(height / 2))
    await page.waitForTimeout(300)
    const st = await page.evaluate(() => {
      const a = window.__pm!.audio!
      return {
        st: a.state(),
        chord: a.chord(),
        sfx: a.sfx('tap'),
        log: a.log.entries().length,
      }
    })
    expect(st.st.disabled).toBe(true)
    expect(st.log, 'a disabled director still logs').toBeGreaterThan(0)
    expect(st.st.ctxState).toBe('none')
    expect(st.st.transport.state).toBe('stopped')
    expect(st.sfx).toBe(false)
    expect(st.chord).toBe('Fmaj7')
    expect(await ctxCount(page)).toBe(0)
    expect(sf).toEqual([])
    expect(consoleErrors).toEqual([])
  })
})
