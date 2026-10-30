// M7 quest text (spec-build2 §3.1–§3.4; design-m7 §6.2, §7 "quest-text"):
// the quest clock (`3d 0h`, `1d 11h`, `<1h`) and the magic countdown, the
// objective sentence per goal kind with the `{district}` flavour, the reward
// line (the sim's rewardSummary), the chip's progress text and label (the
// `✕` glyph of the Golden Release, design-m7 Q11), the district panel row,
// the blocked offer, the QUEST COMPLETE stamp and the newspaper headline per
// reward shape — and every string in glyphs the m5x7 font has. Node only:
// questText.ts is Phaser-free (tools/check-sim-purity.mjs).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { QuestProgress, QuestReward } from '../../src/sim/types.ts'
import { TICKS_PER_DAY } from '../../src/sim/types.ts'
import type { QuestView } from '../../src/sim/view-api.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import * as qt from '../../src/ui/questText.ts'
import { dataFixture, noOffers, offerQuest, quietSim } from '../sim/helpers.ts'

const data = dataFixture()
const DAY = TICKS_PER_DAY
const OFFER_TICK = 150

/** The real offer view of `templateId` (debug offer at tick 150). */
function offer(templateId: string): QuestView {
  const sim = noOffers(quietSim(1))
  sim.state.tick = OFFER_TICK
  offerQuest(sim, templateId)
  const v = createViewSim(sim).quests().offer
  if (!v) throw new Error(`no offer for ${templateId}`)
  return v
}

/** That offer as an active quest with `progress` and `ticksLeft`. */
function active(
  templateId: string,
  progress: Partial<QuestProgress>,
  ticksLeft: number,
  extra: Partial<QuestView> = {},
): QuestView {
  const o = offer(templateId)
  return {
    ...o,
    status: 'active',
    acceptedTick: OFFER_TICK,
    deadlineTick: OFFER_TICK + ticksLeft,
    ticksLeft,
    progress: { ...o.progress, ...progress } as QuestProgress,
    ...extra,
  }
}

/** Retarget a district quest (the view's derived names follow). */
function at(q: QuestView, district: string): QuestView {
  const d = data.districts.find((x) => x.id === district)!
  const line = data.puns.quests[q.templateId] ?? ''
  return {
    ...q,
    target: district,
    targetName: d.flavour,
    flavour: line.replaceAll('{district}', d.flavour),
  }
}

const reward = (r: Partial<QuestReward>): QuestReward => ({
  cash: 0,
  lives: 0,
  satisfaction: 0,
  star: null,
  voucher: null,
  victory: false,
  ...r,
})

/** A QuestsView with these two slots. */
const view = (o: QuestView | null, act: QuestView | null) => ({
  offer: o,
  active: act,
  history: [],
  vouchers: [],
  nextOfferInTicks: null,
  victory: false,
  victoryTick: null,
  magic: null,
})

const TEMPLATE_IDS = [
  ...data.quests.templates.map((t) => t.id),
  'golden_release',
]

describe('design-m7 §6.2: the quest clock (a 60-s day reads as 24 h)', () => {
  it('formatQuestTime: 1800 → 3d 0h, 899 → 1d 11h, 24 → <1h', () => {
    expect(qt.formatQuestTime(1800)).toBe('3d 0h')
    expect(qt.formatQuestTime(899)).toBe('1d 11h')
    expect(qt.formatQuestTime(24)).toBe('<1h')
    expect(qt.formatQuestTime(25)).toBe('1h')
    expect(qt.formatQuestTime(599)).toBe('23h')
    expect(qt.formatQuestTime(DAY)).toBe('1d 0h')
    expect(qt.formatQuestTime(900)).toBe('1d 12h')
    expect(qt.formatQuestTime(0)).toBe('<1h')
    expect(qt.formatQuestTime(-5)).toBe('<1h')
    expect(qt.formatQuestTime(Number.NaN)).toBe('<1h')
  })

  it('formatCountdown: the magic clock in m:ss of real seconds (rounded up)', () => {
    const full = Math.round(data.parcels.magic.countdownS * 10)
    expect(qt.formatCountdown(full)).toBe('2:00')
    expect(qt.formatCountdown(1180)).toBe('1:58')
    expect(qt.formatCountdown(1175)).toBe('1:58')
    expect(qt.formatCountdown(290)).toBe('0:29')
    expect(qt.formatCountdown(1)).toBe('0:01')
    expect(qt.formatCountdown(0)).toBe('0:00')
  })

  it('formatQuestDays: whole days in words, the rest as the clock', () => {
    expect(qt.formatQuestDays(3 * DAY)).toBe('3 days')
    expect(qt.formatQuestDays(DAY)).toBe('1 day')
    expect(qt.formatQuestDays(899)).toBe('1d 11h')
  })

  it('questTicksLeftAt: an offer until it expires, an active quest until its deadline, the Golden Release offer never', () => {
    const o = offer('rush_district')
    expect(qt.questTicksLeftAt(o, OFFER_TICK + 150)).toBe(450)
    expect(qt.questTicksLeftAt(o)).toBe(o.ticksLeft)
    expect(qt.questTicksLeftAt(o, o.expiresTick! + 10)).toBe(0)
    const a = active('rush_district', {}, 900)
    expect(qt.questTicksLeftAt(a, OFFER_TICK + 100)).toBe(800)
    expect(qt.questTicksLeftAt(offer('golden_release'), 999)).toBeNull()
  })
})

describe('design-m7 §6.2: the objective in one sentence, per goal kind', () => {
  const names = qt.buildingNamer(data)

  it('every template and the Golden Release', () => {
    const want: Record<string, string> = {
      rush_district: 'Deliver 6 parcels sent from Registry Row',
      cheer_up: 'Bring Node Heights to 60 satisfaction',
      magic_parcel: 'Deliver the golden parcel across town in 2:00',
      clean_sweep: 'Toss 3 malware in a row — a clean parcel tossed resets it',
      on_time_day: 'One full day at 85% on time (6+ deliveries)',
      big_haul: 'Deliver 3 XL parcels',
      night_shift: 'Make 6 Hold Bay calls without a full bay',
      customs_run: 'Clear 6 parcels through Shrinkwrap Shore',
      inspector_general: 'Hold 95% detection on every strain for a day',
      express_lane: 'Clear 4 parcels through Prefetch International',
      golden_release: 'In 5 days: 60 deliveries, no malware, 90% on time',
    }
    for (const id of TEMPLATE_IDS) {
      let q = offer(id)
      if (id === 'rush_district') q = at(q, 'downtown')
      if (id === 'cheer_up') q = at(q, 'highres')
      expect(qt.objectiveText(data, q, names), id).toBe(want[id])
    }
  })

  it('the magic parcel names A and B once accepted (buildings.json names)', () => {
    const q = active('magic_parcel', {}, 1180, {
      route: { origin: 'dt_registry_tower', dest: 'dt_semver_bank' },
    })
    expect(qt.objectiveText(data, q, names)).toBe(
      'Deliver the golden parcel: Registry Tower → Semver Savings Bank in 2:00',
    )
    expect(names('nowhere')).toBe('nowhere')
  })

  it('level-scaled counts are read from the offer (the card never changes after a level-up)', () => {
    const q = { ...offer('rush_district'), goal: 10 }
    expect(qt.objectiveText(data, at(q, 'downtown'), names)).toBe(
      'Deliver 10 parcels sent from Registry Row',
    )
  })

  it('{district}: the flavour line names the target (verbatim for Registry Row / Node Heights)', () => {
    const rush = at(offer('rush_district'), 'downtown')
    expect(rush.flavour).toBe(
      'Registry Row is swamped — get their parcels moving',
    )
    const cheer = at(offer('cheer_up'), 'highres')
    expect(cheer.flavour).toBe('Node Heights is grumbling; win them back')
    // The sim's own view fills it for the target it picked.
    const real = offer('rush_district')
    expect(real.flavour).toContain(real.targetName!)
    expect(real.flavour).not.toContain('{district}')
  })
})

describe('design-m7 §6.2: the reward line (the sim formatter) and the stamp', () => {
  it('rewardText per template', () => {
    expect(qt.rewardText(data, offer('rush_district'))).toBe('Reward: $120')
    expect(qt.rewardText(data, offer('magic_parcel'))).toBe(
      'Reward: +1 life + $150',
    )
    expect(qt.rewardText(data, at(offer('cheer_up'), 'downtown'))).toBe(
      'Reward: $150 + 5 satisfaction in Registry Row',
    )
    expect(qt.rewardText(data, offer('clean_sweep'))).toBe(
      'Reward: ★ inspector Vera',
    )
    expect(qt.rewardText(data, offer('golden_release'))).toBe('Reward: Victory')
  })

  it('stampText per reward shape: QUEST COMPLETE +$300 / +1 life / ★ Vera', () => {
    expect(qt.stampText(data, reward({ cash: 300 }))).toBe(
      'QUEST COMPLETE +$300',
    )
    expect(qt.stampText(data, reward({ cash: 1200 }))).toBe(
      'QUEST COMPLETE +$1,200',
    )
    expect(qt.stampText(data, offer('magic_parcel').reward)).toBe(
      'QUEST COMPLETE +1 life +$150',
    )
    expect(qt.stampText(data, reward({ lives: 2 }))).toBe(
      'QUEST COMPLETE +2 lives',
    )
    expect(qt.stampText(data, offer('cheer_up').reward)).toBe(
      'QUEST COMPLETE +$150 +5 satisfaction',
    )
    expect(qt.stampText(data, offer('clean_sweep').reward)).toBe(
      'QUEST COMPLETE ★ Vera',
    )
    const checker = data.machines.checkers[0]!
    expect(qt.stampText(data, reward({ voucher: checker.id }))).toBe(
      `QUEST COMPLETE free ${checker.name}`,
    )
    expect(qt.stampText(data, reward({ victory: true }))).toBe(
      'QUEST COMPLETE — VICTORY',
    )
  })
})

describe('design-m7 §6.2: the chip — progress text and the label', () => {
  it('count kinds 4/10, satisfaction 58/60, a day on time 5/6 80%, detection 93%, the Golden Release 41/60', () => {
    expect(
      qt.chipProgressText(
        active('rush_district', { count: 4 }, 900, { goal: 10 }),
      ),
    ).toBe('4/10')
    expect(qt.chipProgressText(active('big_haul', { count: 2 }, 900))).toBe(
      '2/3',
    )
    expect(qt.chipProgressText(active('night_shift', { count: 5 }, 900))).toBe(
      '5/6',
    )
    expect(qt.chipProgressText(active('customs_run', { count: 1 }, 900))).toBe(
      '1/6',
    )
    expect(qt.chipProgressText(active('clean_sweep', { streak: 2 }, 900))).toBe(
      '2/3',
    )
    expect(
      qt.chipProgressText(active('cheer_up', { satisfaction: 58.7 }, 900)),
    ).toBe('58/60')
    expect(
      qt.chipProgressText(
        active('on_time_day', { deliveries: 5, onTime: 4 }, 900),
      ),
    ).toBe('5/6 80%')
    expect(
      qt.chipProgressText(
        active('on_time_day', { deliveries: 0, onTime: 0 }, 900),
      ),
    ).toBe('0/6')
    expect(
      qt.chipProgressText(active('inspector_general', { minPct: 93 }, 900)),
    ).toBe('93%')
    expect(
      qt.chipProgressText(active('golden_release', { delivered: 41 }, 900)),
    ).toBe('41/60')
  })

  it('the magic parcel shows its clock (the full countdown while offered)', () => {
    expect(qt.chipProgressText(active('magic_parcel', {}, 1180))).toBe('1:58')
    expect(qt.chipProgressText(offer('magic_parcel'))).toBe('2:00')
  })

  it('label: an offer shows its expiry; the Golden Release offer none', () => {
    const o = offer('rush_district')
    expect(qt.chipLabel({ ...o, ticksLeft: 450 })).toEqual({
      text: '18h',
      tone: 'light',
    })
    expect(qt.chipLabel(offer('golden_release'))).toEqual({
      text: '',
      tone: 'light',
    })
  })

  it('label: time left on an active quest (amber on its last day)', () => {
    expect(qt.chipLabel(active('rush_district', {}, 900))).toEqual({
      text: '1d 12h',
      tone: 'light',
    })
    expect(qt.chipLabel(active('rush_district', {}, 450))).toEqual({
      text: '18h',
      tone: 'warn',
    })
  })

  it('label: the magic clock, red under 30 s', () => {
    expect(qt.chipLabel(active('magic_parcel', {}, 1180))).toEqual({
      text: '1:58',
      tone: 'light',
    })
    expect(qt.chipLabel(active('magic_parcel', {}, 300))).toEqual({
      text: '0:30',
      tone: 'light',
    })
    expect(qt.chipLabel(active('magic_parcel', {}, 290))).toEqual({
      text: '0:29',
      tone: 'danger',
    })
  })

  it('label: the Golden Release `0✕ 94%` (U+2715 — m5x7 has no ✗), amber under the on-time rate, red with malware', () => {
    const ok = active(
      'golden_release',
      { delivered: 50, onTime: 47, malware: 0 },
      900,
    )
    const l = qt.chipLabel(ok, data)
    expect(l).toEqual({ text: '0✕ 94%', tone: 'light' })
    expect(l.text).toContain('✕')
    expect(l.text).not.toContain('✗')
    expect(qt.CROSS).toBe('✕')
    const late = active(
      'golden_release',
      { delivered: 50, onTime: 40, malware: 0 },
      900,
    )
    expect(qt.chipLabel(late, data)).toEqual({ text: '0✕ 80%', tone: 'warn' })
    // Without data the rate threshold is unknown: no amber.
    expect(qt.chipLabel(late).tone).toBe('light')
    const bad = active(
      'golden_release',
      { delivered: 50, onTime: 50, malware: 1 },
      900,
    )
    expect(qt.chipLabel(bad, data)).toEqual({ text: '1✕ 100%', tone: 'danger' })
    // Nothing delivered yet: nothing late yet.
    const fresh = active(
      'golden_release',
      { delivered: 0, onTime: 0, malware: 0 },
      3000,
    )
    expect(qt.chipLabel(fresh, data).text).toBe('0✕ 100%')
  })
})

describe('design-m7 §6.5: the district panel row and the blocked offer', () => {
  it('Rush hour · 4/10 · 1d 12h while active; Job offer: Rush hour ▸ while offered', () => {
    expect(
      qt.questRowText(active('rush_district', { count: 4 }, 900, { goal: 10 })),
    ).toBe('Rush hour · 4/10 · 1d 12h')
    expect(qt.questRowText(offer('rush_district'))).toBe(
      'Job offer: Rush hour ▸',
    )
    expect(qt.questRowText(active('magic_parcel', {}, 1180))).toBe(
      'Special delivery · 1:58',
    )
  })

  it('an offer waits on the active quest (the Golden Release while Rush hour runs)', () => {
    const u = offer('golden_release')
    const a = active('rush_district', {}, 900, { id: 'q9' })
    expect(qt.questBlockedBy(view(u, a), u)).toBe('Rush hour')
    expect(qt.questBlockedBy(view(u, null), u)).toBeNull()
    expect(qt.questBlockedBy(view(null, a), a)).toBeNull()
  })

  it('the active quest names the offer waiting on it (review M7: the waiting Golden Release was invisible)', () => {
    const u = offer('golden_release')
    const a = active('rush_district', {}, 900, { id: 'q9' })
    expect(qt.questWaitingOn(view(u, a), a)).toBe('The Golden Release')
    expect(qt.questWaitingOn(view(u, a), u)).toBeNull() // the offer itself
    expect(qt.questWaitingOn(view(null, a), a)).toBeNull()
    expect(qt.waitingText('The Golden Release')).toBe(
      'The Golden Release is waiting — finish or abandon this job to take it.',
    )
  })
})

describe('design-m7 §6.7: the newspaper headline per reward', () => {
  it('a quest: RUSH HOUR DONE — Registry Row is moving again: +$200', () => {
    const q = at(offer('rush_district'), 'downtown')
    expect(qt.newsHeadline(data, q, reward({ cash: 200 }))).toEqual({
      kind: 'quest',
      text: 'RUSH HOUR DONE — Registry Row is moving again: +$200',
    })
    const magic = offer('magic_parcel')
    expect(qt.newsHeadline(data, magic, magic.reward)).toEqual({
      kind: 'quest',
      text: 'SPECIAL DELIVERY DONE — the VIP got the golden parcel on time: +1 life +$150',
    })
  })

  it('a ★ reward: Star inspector Vera wants to join (Clean sweep)', () => {
    const q = offer('clean_sweep')
    expect(qt.newsHeadline(data, q, q.reward)).toEqual({
      kind: 'star',
      text: 'Star inspector Vera wants to join (Clean sweep)',
    })
    const rae = offer('on_time_day')
    expect(qt.newsHeadline(data, rae, rae.reward)).toEqual({
      kind: 'star',
      text: 'Star driver Rae wants to join (Like clockwork)',
    })
  })

  it('the Golden Release: the puns tickerQuest.victory line', () => {
    const q = offer('golden_release')
    expect(qt.newsHeadline(data, q, q.reward)).toEqual({
      kind: 'quest',
      text: 'The Golden Release ships — Node Heights Courier is a Tycoon!',
    })
  })
})

describe('m5x7: every quest string is drawn in glyphs the font has', () => {
  const xml = readFileSync(
    new URL('../../src/assets/m5x7.xml', import.meta.url),
    'utf8',
  )
  const glyphs = new Set(
    [...xml.matchAll(/<char id="(\d+)"/g)].map((m) => Number(m[1])),
  )
  const missing = (s: string): string[] =>
    [...s].filter((ch) => ch !== '\n' && !glyphs.has(ch.codePointAt(0)!))

  it('objectives, flavour, rewards, chip texts, rows, stamps and headlines for every template', () => {
    const names = qt.buildingNamer(data)
    const strings: string[] = []
    for (const id of TEMPLATE_IDS) {
      for (const d of data.districts) {
        const o = at(offer(id), d.id)
        const a = {
          ...active(id, {}, 900),
          target: o.target,
          targetName: o.targetName,
          flavour: o.flavour,
        }
        for (const q of [o, a]) {
          strings.push(
            q.name,
            q.flavour,
            qt.objectiveText(data, q, names),
            qt.rewardText(data, q),
            qt.chipProgressText(q),
            qt.chipLabel(q, data).text,
            qt.questRowText(q),
            qt.stampText(data, q.reward),
            qt.newsHeadline(data, q, q.reward).text,
          )
        }
      }
    }
    const bad = strings.flatMap((s) =>
      missing(s).map((ch) => `${ch} in "${s}"`),
    )
    expect(bad).toEqual([])
    // The glyphs the quest UI leans on are really there.
    for (const ch of ['✕', '★', '—', '·', '▸', '…', '→'])
      expect(glyphs.has(ch.codePointAt(0)!), ch).toBe(true)
  })
})
