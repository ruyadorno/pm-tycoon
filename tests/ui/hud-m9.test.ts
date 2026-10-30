// M9 HUD + cards (design-m8-m9 §6.3, §7 M9 10; spec-build2 §3.4, §4.2-§4.3;
// plan-build2 §8.6 tasks 1, 3): a real game climbing the shipped levels.json
// (cap 5) read through the HUD's pure models — L4 counts toward L5 with no
// "coming soon", the L4 / L5 papers show the tier-4 / tier-5 exteriors and the
// new regions' hero buildings, level:up {5} offers the Golden Release on the
// same tick (the gold QuestCard: Accept / Later, the chip `0/60`), the bar
// reads `$… · Tycoon` and, from game:victory on, `· Tycoon ✓` (the
// VictoryCard model says `Lv5 Tycoon`); after Continue the sim's own endless
// line (`Endless mode — the malware keeps evolving`, ticker:news 'level')
// comes once at the first day boundary after the Victory. Every M9 string the
// HUD draws is in m5x7 (✓ is drawn by tools/art/font.ts). Phaser is stubbed
// (QuestCard / Newspaper / VictoryCard import the Button kit).
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => {
  class Stub {
    readonly stub = true
  }
  return {
    default: {
      Scene: Stub,
      GameObjects: { Container: Stub, NineSlice: Stub, Image: Stub },
      Geom: { Rectangle: Stub },
    },
  }
})

const kit = await import('../../src/ui/hudKit.ts')
const np = await import('../../src/ui/Newspaper.ts')
const qc = await import('../../src/ui/QuestCard.ts')
const chip = await import('../../src/ui/QuestChip.ts')
const qt = await import('../../src/ui/questText.ts')
const vc = await import('../../src/ui/VictoryCard.ts')
const { tickerTint } = await import('../../src/ui/Ticker.ts')
const { THEME } = await import('../../src/ui/theme.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { TICKS_PER_DAY } = await import('../../src/sim/types.ts')
const h = await import('../sim/helpers.ts')

import type { Sim } from '../../src/sim/sim.ts'

const data = h.dataFixture()
const L4 = data.levels.find((l) => l.level === 4)!
const L5 = data.levels.find((l) => l.level === 5)!
const ENDLESS = data.puns.tickerQuest.endless

/** The HUD's refreshLevel model for `sim` (compact = the chip shows). */
function bar(sim: Sim, compact = false) {
  const vs = createViewSim(sim)
  return kit.levelProgress(
    data,
    vs.level,
    vs.lifetimeEarned,
    vs.nextThreshold,
    {
      compact,
      victory: vs.victory,
    },
  )
}

/** Lifetime earned to `threshold`, one tick: the levels.json way up. */
function earn(sim: Sim, threshold: number): void {
  sim.state.economy.lifetimeEarned = Math.max(
    sim.state.economy.lifetimeEarned,
    threshold,
  )
  h.runTicks(sim, 1)
  h.quiet(sim)
}

describe('L4 National (B2 §4.2): the bar, the tap toast, the paper', () => {
  it('counts toward L5 with no "coming soon"; the paper shows wh_ext_t4 and the new regions their hero buildings', () => {
    expect(data.economy.playtestMaxLevel).toBe(5)
    const sim = h.noOffers(h.quietSim(31))
    const ups = h.collect(sim, 'level:up')
    earn(sim, L4.threshold)
    expect(sim.state.level.level).toBe(4)
    expect(ups.map((u) => u.level)).toEqual([2, 3, 4])
    const p = bar(sim)
    expect(p.atCap).toBe(false)
    expect(p.text).toBe(
      `$${L4.threshold.toLocaleString('en-US')} / $${L5.threshold.toLocaleString('en-US')}`,
    )
    expect(p.frac).toBe(0)
    expect(kit.nextUnlockLine(data, 4)).toBe(
      'Lv 5: Prefetch International + Monorepo Commons',
    )
    expect(np.newsPicture('level', data, { level: 4 })).toBe('wh_ext_t4')
    expect(np.newsPicture('level', data, { level: 5 })).toBe('wh_ext_t5')
    for (const d of ['lowres', 'rural', 'airport', 'civic']) {
      const hero = np.heroBuilding(data, d)
      expect(hero?.district, d).toBe(d)
      // The picture is the hero's sprite (or none while its art is missing:
      // the paper then has no picture — never a crash).
      const pic = np.newsPicture('region', data, { district: d })
      expect(pic === null || typeof pic === 'string', d).toBe(true)
    }
  })

  it('a debug-forced level books no income: the bar reads the real total, empty below the row threshold (L4) and "$N · Tycoon" at L5', () => {
    const sim = h.noOffers(h.quietSim(32))
    const vs = createViewSim(sim, { debug: true })
    expect(vs.debug!.forceLevel(4)).toEqual({ ok: true })
    const p4 = bar(sim)
    expect(p4.frac).toBe(0)
    expect(p4.text).toBe(`$0 / $${L5.threshold.toLocaleString('en-US')}`)
    expect(vs.debug!.forceLevel(5)).toEqual({ ok: true })
    expect(bar(sim).text).toBe('$0 · Tycoon')
  })
})

describe('L5 Tycoon (B2 §3.4, §4.3): the Golden Release offer, Victory and endless', () => {
  it('level:up {5} → quest:offered golden_release on the same tick: the gold card (Accept / Later), the pulsing chip, "$… · Tycoon"', () => {
    const sim = h.noOffers(h.quietSim(32))
    const log = h.eventLog(sim)
    earn(sim, L5.threshold)
    const vs = createViewSim(sim)
    expect(vs.level).toBe(5)
    expect(vs.nextThreshold).toBeNull()
    const up = log.find(
      (e) => e.name === 'level:up' && (e.p as { level: number }).level === 5,
    )!
    const offered = log.find((e) => e.name === 'quest:offered')!
    expect(offered.tick).toBe(up.tick)
    expect(offered.p).toMatchObject({ ultimate: true })
    // The level bar at the top level.
    expect(bar(sim)).toEqual({
      frac: 1,
      text: `$${L5.threshold.toLocaleString('en-US')} · Tycoon`,
      atCap: false,
    })
    expect(bar(sim, true).text).toBe(`$${L5.threshold.toLocaleString('en-US')}`)
    // The QuestCard: gold, its own masthead, no Decline; it may open by
    // itself in a calm city (the level paper first, design-m7 §6.5).
    const qs = vs.quests()
    const q = qs.offer!
    expect(q.ultimate).toBe(true)
    const m = qc.questCardModel(
      data,
      q,
      'offer',
      vs.tick,
      qt.buildingNamer(data),
      qt.questBlockedBy(qs, q),
    )
    expect(m).toMatchObject({
      gold: true,
      masthead: data.puns.ultimateQuestName.toUpperCase(),
      buttons: ['accept', 'later'],
      blocked: null,
    })
    const auto = {
      modals: 0,
      onboardingStep: null,
      view: 'city' as const,
      held: false,
      paperVisible: false,
      blocked: false,
      force: false,
      policy: false,
    }
    expect(kit.questCardAutoOpens(auto)).toBe(true)
    expect(kit.questCardAutoOpens({ ...auto, paperVisible: true })).toBe(false)
    expect(chip.questChipModel(qs, data)).toMatchObject({
      visible: true,
      pulse: true,
      gold: true,
      barText: chip.QUEST_OFFER_TEXT,
    })
    // Accepted: the chip counts the Golden Release (`0/60`).
    h.acceptOffer(sim)
    const active = chip.questChipModel(createViewSim(sim).quests(), data)
    expect(active).toMatchObject({ gold: true, pulse: false })
    expect(active.barText).toBe(`0/${L5.ultimateQuest!.deliveries}`)
  })

  it('game:victory → "· Tycoon ✓", the VictoryCard (Lv5 Tycoon); Continue → the endless line once, at the first day boundary after it', () => {
    const sim = h.noOffers(h.quietSim(33))
    earn(sim, L5.threshold)
    h.acceptOffer(sim)
    h.runTicks(sim, 200)
    const victory = h.collect(sim, 'game:victory')
    const news = h.collect(sim, 'ticker:news')
    for (let i = 0; i < L5.ultimateQuest!.deliveries; i++) {
      const p = h.injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
      sim.emit('parcel:delivered', {
        id: p.id,
        paid: 20,
        onTime: true,
        malware: false,
      })
    }
    h.runTicks(sim, 1)
    expect(victory).toHaveLength(1)
    const vs = createViewSim(sim)
    expect(vs.victory).toBe(true)
    // The bar and its tap toast (onVictory re-reads the bar at once).
    expect(bar(sim).text).toBe(
      `${'$' + vs.lifetimeEarned.toLocaleString('en-US')} · Tycoon ✓`,
    )
    expect(bar(sim, true).text).toBe(
      `${'$' + vs.lifetimeEarned.toLocaleString('en-US')} ✓`,
    )
    expect(kit.nextUnlockLine(data, vs.level, vs.victory)).toBe(
      'Tycoon ✓ — endless mode',
    )
    // The VictoryCard model (M7's card, unchanged).
    const s = sim.state
    const model = vc.victoryModel(
      {
        day: s.day,
        lifetimeEarned: s.economy.lifetimeEarned,
        deliveries: s.stats.deliveries,
        malwareMissed: s.stats.malwareMissed,
        defused: s.lane.quarantine.malware,
        lives: s.economy.lives,
        level: s.level.level,
        victoryTick: s.stats.victoryTick ?? s.tick,
      },
      data,
    )
    expect(model.title).toBe('TYCOON')
    expect(model.stats.at(-1)).toEqual(['Level reached', 'Lv5 Tycoon'])
    // Continue = the sim runs on: nothing until the next day boundary, then
    // the sim's endless line (kind 'level', light) exactly once.
    const victoryTick = s.stats.victoryTick!
    const boundary =
      (Math.floor(victoryTick / TICKS_PER_DAY) + 1) * TICKS_PER_DAY
    h.runTicks(sim, boundary - sim.state.tick - 1)
    expect(news.filter((n) => n.text === ENDLESS)).toEqual([])
    h.runTicks(sim, 1)
    expect(news.filter((n) => n.text === ENDLESS)).toEqual([
      { text: ENDLESS, kind: 'level' },
    ])
    expect(tickerTint('level')).toBe(THEME.textLight)
    h.runTicks(sim, 2 * TICKS_PER_DAY)
    expect(news.filter((n) => n.text === ENDLESS)).toHaveLength(1)
    // The bar keeps its mark in endless play.
    expect(bar(sim).text).toMatch(/ · Tycoon ✓$/)
  })
})

describe('the L5 chips scroll into view on unlock; edge marks while the row overflows (final review, mobile #1)', () => {
  // 393 px: x0 6, maxRowW 381, the row 495 wide; Airport at 391, Commons at
  // 443 to 501 (+ its NEW badge 4 px past the chip).
  it('chipRevealScroll brings the rightmost new chip and its badge fully inside, with the least movement', () => {
    const s = kit.chipRevealScroll(0, 6, 381, 443, 505)
    expect(s).toBe(6 + 381 - 505)
    expect(505 + s).toBeLessThanOrEqual(6 + 381)
    expect(391 + s).toBeGreaterThanOrEqual(6) // Airport is in view too
    // Already in view: no movement; a chip left of the view scrolls back.
    expect(kit.chipRevealScroll(-40, 6, 381, 100, 160)).toBe(-40)
    expect(kit.chipRevealScroll(-200, 6, 381, 100, 160)).toBe(-94)
    expect(kit.chipRevealScroll(0, 6, 381, 6, 60)).toBe(0)
  })

  it('chipOverflow: `>` while chips hide past the right edge, `<` once scrolled', () => {
    expect(kit.chipOverflow(0, 495, 381)).toEqual({ left: false, right: true })
    expect(kit.chipOverflow(-114, 495, 381)).toEqual({
      left: true,
      right: false,
    })
    expect(kit.chipOverflow(0, 300, 381)).toEqual({ left: false, right: false })
  })
})

describe('a reload of the victory-tick save reopens the VictoryCard (final review, scenes #2)', () => {
  it('victoryCardPending: within the slack of stats.victoryTick, before Continue; never before the Victory, after endless play ran, or after a game over', () => {
    const won = { victory: true, victoryTick: 30_000 }
    expect(kit.victoryCardPending(won, 30_000, false, 20)).toBe(true)
    expect(kit.victoryCardPending(won, 30_020, false, 20)).toBe(true)
    // Endless play ran (the next autosave is 10 s = 100 ticks at 1x later).
    expect(kit.victoryCardPending(won, 30_100, false, 20)).toBe(false)
    expect(kit.victoryCardPending(won, 30_000, true, 20)).toBe(false)
    expect(
      kit.victoryCardPending(
        { victory: false, victoryTick: null },
        0,
        false,
        20,
      ),
    ).toBe(false)
    expect(
      kit.victoryCardPending(
        { victory: true, victoryTick: null },
        5,
        false,
        20,
      ),
    ).toBe(false)
  })

  it('the HUD calls it on the boot sync only (a WAKE / sim swap keeps the card closed)', () => {
    const src = readFileSync('src/scenes/HudScene.ts', 'utf8')
    const body = src.slice(
      src.indexOf('  private syncQuests(): void {'),
      src.indexOf(
        '  // ---------------------------------------------------------------- step 2',
      ),
    )
    expect(body).toMatch(/boot &&\s+victoryCardPending\(/)
    expect(body).toContain('this.onVictory()')
  })
})

describe('the top-level bar texts fit their bars in m5x7 (design-m8-m9 critic notes)', () => {
  const xml = readFileSync(
    new URL('../../src/assets/m5x7.xml', import.meta.url),
    'utf8',
  )
  const adv = new Map<number, number>()
  for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
    adv.set(Number(m[1]), Number(m[2]))
  // ✓ is drawn by tools/art/font.ts (M9); a missing glyph counts 8 px.
  const width = (t: string): number =>
    [...t].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 8), 0)

  it('full at every width, compact beside the quest chip at 360 (98 px), up to $9,999,999', async () => {
    const { computeLayout } = await import('../../src/ui/layout.ts')
    for (const W of [360, 393, 430]) {
      const L = computeLayout(W, 700, 0, 0, 1)
      for (const money of [18400, 1_234_567, 9_999_999]) {
        const full = kit.levelProgress(data, 5, money, null, { victory: true })
        expect(width(full.text), `${W} ${full.text}`).toBeLessThanOrEqual(
          L.levelBar.w,
        )
        const compact = kit.levelProgress(data, 5, money, null, {
          compact: true,
          victory: true,
        })
        expect(width(compact.text), `${W} ${compact.text}`).toBeLessThanOrEqual(
          L.levelBarChip.w,
        )
      }
    }
  })
})

describe('m5x7: every M9 HUD string is drawn in glyphs the font has', () => {
  const xml = readFileSync(
    new URL('../../src/assets/m5x7.xml', import.meta.url),
    'utf8',
  )
  const glyphs = new Set(
    [...xml.matchAll(/<char id="(\d+)"/g)].map((m) => Number(m[1])),
  )
  const missing = (s: string): string[] =>
    [...s].filter((ch) => !glyphs.has(ch.codePointAt(0)!))

  it('the top-level bar, its toast, the Continue mark and the endless line (✓ U+2713 is a drawn glyph, tools/art/font.ts)', () => {
    const strings = [
      kit.levelProgress(data, 5, 18400, null).text,
      kit.levelProgress(data, 5, 18400, null, { victory: true }).text,
      kit.nextUnlockLine(data, 5),
      kit.nextUnlockLine(data, 5, true),
      kit.nextUnlockLine(data, 3),
      kit.nextUnlockLine(data, 4),
      ENDLESS,
      'Day 12 · $18,400 · Lv 5 · Tycoon ✓',
      'Cleared 14:47 — the plane has left',
    ]
    const bad = strings.flatMap((s) =>
      missing(s).map((ch) => `${ch} in "${s}"`),
    )
    expect(bad).toEqual([])
  })
})
