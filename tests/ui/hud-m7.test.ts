// M7 HUD rules (spec-build2 §3.1, §3.3, §3.4; plan-build2 §8.4 task 4;
// design-m7 §6.4-§6.5): the quest chip model (offer pulse + expiry, active
// count + time left, the golden parcel's clock red under 30 s, the Golden
// Release `41/60` + `0✕ 95%`), the compact level text the chip leaves room
// for, the bomb slots 4-5 lighting on life:gained, the gold / grey ticker
// lines, when a new offer opens its card by itself, and the gold bar / card
// frames (world atlas: the HUD binds `world` only).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FRAME_ATLAS, isFrame } from '../../src/render/frames.generated.ts'
import type { Sim } from '../../src/sim/sim.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  levelProgress,
  lifeGainedToast,
  questCardAutoOpens,
  type QuestAutoOpen,
} from '../../src/ui/hudKit.ts'
import {
  GAIN_STEPS,
  FUSE_STEP_MS,
  gainingSlots,
  lifeFrames,
} from '../../src/ui/LivesRow.ts'
import { BAR_FILL, barFrame } from '../../src/ui/Panel.ts'
import {
  QUEST_CHIP_BAR_W,
  QUEST_CHIP_COMPACT_W,
  QUEST_CHIP_W,
} from '../../src/ui/layout.ts'
import {
  QUEST_CHIP_BAR_MIN_W,
  QUEST_CHIP_BAR_X,
  QUEST_CHIP_HIDDEN,
  QUEST_CHIP_LABEL_GAP,
  QUEST_OFFER_TEXT,
  QUEST_PULSE_ALPHA,
  questChipFillColour,
  questChipFit,
  questChipModel,
  questChipTint,
  questPulseAlpha,
} from '../../src/ui/QuestChip.ts'
import { THEME } from '../../src/ui/theme.ts'
import { tickerTint } from '../../src/ui/Ticker.ts'
import {
  acceptOffer,
  buy,
  dataFixture,
  fund,
  makeSim,
  noOffers,
  offerQuest,
  quietSim,
  runTicks,
  startQuest,
} from '../sim/helpers.ts'

const data = dataFixture()

/** A fresh ViewSim per read: no revision cache between state edits. */
const quests = (sim: Sim) => createViewSim(sim).quests()
const chip = (sim: Sim) => questChipModel(quests(sim), sim.data)

describe('the quest chip (design-m7 §6.4)', () => {
  it('is hidden with no offer and no active quest', () => {
    const sim = noOffers(makeSim(1))
    expect(chip(sim)).toEqual(QUEST_CHIP_HIDDEN)
    expect(chip(sim).visible).toBe(false)
  })

  it('an offer pulses at 1 Hz with `New job` in place of the bar and no label (build 3: a job offer never expires)', () => {
    const sim = noOffers(makeSim(1))
    offerQuest(sim, 'rush_district')
    const m = chip(sim)
    expect(m).toMatchObject({
      visible: true,
      icon: 'ic_quest',
      pulse: true,
      bar: null,
      barText: QUEST_OFFER_TEXT,
      // B3 §3.2 / D-18: the sim waits on the job card — no countdown.
      label: '',
      tone: 'light',
      gold: false,
    })
    // Held on the card: no time passes, the chip still reads the same.
    runTicks(sim, 300)
    expect(chip(sim)).toMatchObject({ pulse: true, label: '' })
    expect(questPulseAlpha(true, 0)).toBe(1)
    expect(questPulseAlpha(true, 499)).toBe(1)
    expect(questPulseAlpha(true, 500)).toBe(QUEST_PULSE_ALPHA)
    expect(questPulseAlpha(true, 1000)).toBe(1)
    expect(questPulseAlpha(false, 500)).toBe(1)
  })

  it('active Rush hour reads `4/10` on a 40 % bar and `1d 12h` left (warn on its last day)', () => {
    const sim = noOffers(makeSim(1))
    // The goal is read at offer time from the level-indexed count (L2: 10).
    sim.state.level.level = 2
    const q = startQuest(sim, 'rush_district')
    expect(q.goal).toBe(10)
    if (q.progress.kind !== 'deliveriesFrom') throw new Error(q.progress.kind)
    q.progress.count = 4
    q.deadlineTick = sim.state.tick + 600 + 12 * 25
    const m = chip(sim)
    expect(m).toMatchObject({
      visible: true,
      icon: 'ic_quest',
      pulse: false,
      bar: 0.4,
      barText: '4/10',
      label: '1d 12h',
      tone: 'light',
      gold: false,
    })
    q.deadlineTick = sim.state.tick + 500
    expect(chip(sim)).toMatchObject({ label: '20h', tone: 'warn' })
    expect(questChipTint({ tone: 'warn', gold: false })).toBe(THEME.warn)
  })

  it('the golden parcel: ic_magic, a draining bar, the `m:ss` clock as the label, red under 30 s', () => {
    const sim = noOffers(fund(quietSim(1)))
    buy(sim, 'bike')
    startQuest(sim, 'magic_parcel')
    const m = chip(sim)
    expect(m).toMatchObject({
      icon: 'ic_magic',
      pulse: false,
      bar: 1,
      barText: '',
      label: '2:00',
      tone: 'light',
    })
    runTicks(sim, 20)
    const m2 = chip(sim)
    expect(m2.label).toBe('1:58')
    expect(m2.bar).toBeCloseTo(1180 / 1200, 5)
    // 29 s left: red.
    const a = sim.state.quests.active
    expect(a?.progress.kind).toBe('magicParcel')
    a!.deadlineTick = sim.state.tick + 290
    const m3 = chip(sim)
    expect(m3).toMatchObject({ label: '0:29', tone: 'danger' })
    expect(questChipTint(m3)).toBe(THEME.danger)
  })

  it('the Golden Release: `41/60` on the bar, `0✕ 95%` gold; malware turns it red', () => {
    const sim = noOffers(makeSim(1))
    offerQuest(sim, 'golden_release')
    const offer = chip(sim)
    // No expiry: an empty label, still pulsing.
    expect(offer).toMatchObject({ pulse: true, label: '', gold: true })
    const q = acceptOffer(sim)
    if (q.progress.kind !== 'ultimate') throw new Error(q.progress.kind)
    q.progress.delivered = 41
    q.progress.onTime = 39
    const m = chip(sim)
    expect(m).toMatchObject({
      icon: 'ic_quest',
      barText: '41/60',
      label: '0✕ 95%',
      tone: 'light',
      gold: true,
    })
    expect(questChipTint(m)).toBe(THEME.gold)
    q.progress.malware = 1
    const red = chip(sim)
    expect(red).toMatchObject({ label: '1✕ 95%', tone: 'danger' })
    expect(questChipTint(red)).toBe(THEME.danger)
  })

  it('the active quest wins over an offer waiting behind it, and the chip pulses for it (its card names the offer)', () => {
    const sim = noOffers(makeSim(1))
    startQuest(sim, 'rush_district')
    // The Golden Release offered while Rush hour runs (design-m7 §4).
    sim.state.quests.offer = {
      ...structuredClone(sim.state.quests.active!),
      id: 'q99',
      templateId: 'golden_release',
      ultimate: true,
      status: 'offered',
      expiresTick: null,
      acceptedTick: null,
      deadlineTick: null,
    }
    const qs = quests(sim)
    expect(qs.active?.templateId).toBe('rush_district')
    expect(questChipModel(qs, data)).toMatchObject({
      pulse: true,
      gold: false,
      barText: '0/6',
    })
  })
})

describe('the level bar beside the chip (design-m7 §6.4)', () => {
  it('compact drops the `· Lv N coming soon` suffix at the cap', () => {
    const cap = data.economy.playtestMaxLevel
    const next = data.levels.find((l) => l.level === cap + 1)
    if (!next) return
    const full = levelProgress(data, cap, 3410, next.threshold)
    expect(full.text).toContain('coming soon')
    const short = levelProgress(data, cap, 3410, next.threshold, {
      compact: true,
    })
    expect(short.text).not.toContain('coming soon')
    expect(short.text).toBe(full.text.split(' · ')[0])
    expect(short.frac).toBe(full.frac)
    expect(short.atCap).toBe(true)
  })
})

describe('life:gained (spec-build2 §3.3: slots 4-5 light above 3)', () => {
  it('the newly lit slot is the one gained (none at the cap)', () => {
    expect(gainingSlots(4, 3)).toEqual([3])
    expect(gainingSlots(5, 4)).toEqual([4])
    expect(gainingSlots(5, 3)).toEqual([3, 4])
    expect(gainingSlots(5, 5)).toEqual([])
    expect(gainingSlots(6, 5)).toEqual([])
    expect(lifeFrames(5)).toEqual(Array(5).fill('ic_life_on'))
  })

  it('it blinks on/off three times at the fuse step and ends lit (frames only)', () => {
    expect(GAIN_STEPS.filter((f) => f === 'ic_life_off')).toHaveLength(3)
    expect(GAIN_STEPS[0]).toBe('ic_life_on')
    expect(GAIN_STEPS[GAIN_STEPS.length - 1]).toBe('ic_life_on')
    expect(GAIN_STEPS.length * FUSE_STEP_MS).toBe(700)
  })

  it('toasts `+1 life — 4 of 5` (economy.lives.cap)', () => {
    const cap = data.economy.lives.cap
    expect(lifeGainedToast(4, 1, cap)).toBe(`+1 life — 4 of ${cap}`)
    expect(lifeGainedToast(5, 2, cap)).toBe(`+2 lives — 5 of ${cap}`)
  })
})

describe('quest ticker lines (spec-build2 §3.1)', () => {
  it('quest lines run gold, a failed quest grey, the rest light', () => {
    expect(tickerTint('quest')).toBe(THEME.gold)
    expect(tickerTint('questFailed')).toBe(THEME.textMuted)
    expect(tickerTint('level')).toBe(THEME.textLight)
    expect(tickerTint('offer')).toBe(THEME.textLight)
  })
})

describe('the chip label fits beside the bar (design-m7 §6.4, m5x7)', () => {
  const xml = readFileSync(
    new URL('../../src/assets/m5x7.xml', import.meta.url),
    'utf8',
  )
  const adv = new Map<number, number>()
  for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
    adv.set(Number(m[1]), Number(m[2]))
  const width = (s: string): number =>
    [...s].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 6), 0)
  /** Air between the bar's end and the right-aligned label. */
  const gap = (f: { label: string; barW: number }): number =>
    QUEST_CHIP_W - width(f.label) - (QUEST_CHIP_BAR_X + f.barW)

  it('the 35-px times (`1d 12h`) keep the full 60-px bar and are never cut', () => {
    expect(width('1d 12h')).toBe(35)
    for (const s of ['1d 12h', '4d 23h', '23h', '<1h', '1:59', '0:05']) {
      const f = questChipFit(s, QUEST_CHIP_W, width)
      expect(f, s).toEqual({ label: s, barW: QUEST_CHIP_BAR_W })
      expect(gap(f), s).toBeGreaterThanOrEqual(QUEST_CHIP_LABEL_GAP)
    }
  })

  it('a wider Golden Release label (`0✕ 100%`) takes the difference from the bar', () => {
    const f = questChipFit('0✕ 100%', QUEST_CHIP_W, width)
    expect(f.label).toBe('0✕ 100%')
    expect(f.barW).toBeLessThan(QUEST_CHIP_BAR_W)
    expect(f.barW).toBeGreaterThanOrEqual(QUEST_CHIP_BAR_MIN_W)
    expect(gap(f)).toBe(QUEST_CHIP_LABEL_GAP)
  })

  it('past the bar floor the label is ellipsized', () => {
    const f = questChipFit('123✕ 100% on time', QUEST_CHIP_W, width)
    expect(f.barW).toBe(QUEST_CHIP_BAR_MIN_W)
    expect(f.label.endsWith('…')).toBe(true)
    expect(gap(f)).toBeGreaterThanOrEqual(QUEST_CHIP_LABEL_GAP)
  })

  it('B3 §3.4: the compact chip (82 px, beside the event chip) drops the label, keeps the 60-px bar', () => {
    expect(QUEST_CHIP_COMPACT_W).toBe(82)
    expect(questChipFit('1d 12h', QUEST_CHIP_COMPACT_W, width)).toEqual({
      label: '',
      barW: 60,
    })
    for (const s of ['0✕ 100%', '1:59', '123✕ 100% on time', ''])
      expect(questChipFit(s, QUEST_CHIP_COMPACT_W, width), s).toEqual({
        label: '',
        barW: QUEST_CHIP_BAR_W,
      })
    // The icon + the full bar fit the compact chip.
    expect(QUEST_CHIP_BAR_X + QUEST_CHIP_BAR_W).toBeLessThanOrEqual(
      QUEST_CHIP_COMPACT_W,
    )
    // The full chip still keeps its label.
    expect(questChipFit('1d 12h', QUEST_CHIP_W, width).label).toBe('1d 12h')
  })

  it('D-M12-10: the compact chip moves the warning into the bar fill; the full chip stays gold', () => {
    expect(questChipFillColour({ tone: 'danger' }, QUEST_CHIP_COMPACT_W)).toBe(
      'red',
    )
    expect(questChipFillColour({ tone: 'warn' }, QUEST_CHIP_COMPACT_W)).toBe(
      'amber',
    )
    expect(questChipFillColour({ tone: 'light' }, QUEST_CHIP_COMPACT_W)).toBe(
      'gold',
    )
    for (const tone of ['danger', 'warn', 'light'] as const)
      expect(questChipFillColour({ tone }, QUEST_CHIP_W), tone).toBe('gold')
    for (const c of ['red', 'amber', 'gold'] as const)
      expect(FRAME_ATLAS[BAR_FILL[c]], c).toBe('world')
  })
})

describe('a new offer opens its card by itself (design-m7 §6.5)', () => {
  const calm: QuestAutoOpen = {
    modals: 0,
    onboardingStep: null,
    view: 'city',
    held: false,
    paperVisible: false,
    blocked: false,
    force: false,
    policy: false,
  }

  it('only in a calm city', () => {
    expect(questCardAutoOpens(calm)).toBe(true)
    expect(questCardAutoOpens({ ...calm, modals: 1 })).toBe(false)
    expect(questCardAutoOpens({ ...calm, onboardingStep: 2 })).toBe(false)
    expect(questCardAutoOpens({ ...calm, view: 'warehouse' })).toBe(false)
    expect(questCardAutoOpens({ ...calm, held: true })).toBe(false)
    expect(questCardAutoOpens({ ...calm, paperVisible: true })).toBe(false)
  })

  it('never for the Golden Release while a regular quest is active', () => {
    expect(questCardAutoOpens({ ...calm, blocked: true })).toBe(false)
    expect(questCardAutoOpens({ ...calm, blocked: true, force: true })).toBe(
      false,
    )
  })

  it('an offer found at load (a reload, ?quest=) ignores the tour only', () => {
    expect(
      questCardAutoOpens({ ...calm, onboardingStep: 1, force: true }),
    ).toBe(true)
    expect(questCardAutoOpens({ ...calm, modals: 1, force: true })).toBe(false)
  })

  it('never while a policy drives the stepper (it answers the offer itself)', () => {
    expect(questCardAutoOpens({ ...calm, policy: true })).toBe(false)
    expect(questCardAutoOpens({ ...calm, policy: true, force: true })).toBe(
      false,
    )
  })
})

describe('quest frames (B2 §6.8, design-m7 §6.1 Q10: world atlas)', () => {
  it('the gold bar fill and card frame exist and are world frames', () => {
    expect(barFrame('gold')).toBe('ui_bar_fill_gold')
    expect(BAR_FILL.gold).toBe('ui_bar_fill_gold')
    for (const f of [
      'ui_bar_fill_gold',
      'ui_card_gold',
      'ui_tag',
      'ui_bar_track',
      'ic_quest',
      'ic_magic',
      'ic_life_on',
      'ic_life_off',
    ]) {
      expect(isFrame(f), f).toBe(true)
      if (isFrame(f)) expect(FRAME_ATLAS[f], f).toBe('world')
    }
  })
})
