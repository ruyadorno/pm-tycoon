// plan.md §12.9 summary card, v2 plan-build2 §8.7 task 2 / §9, v3
// plan-build3 §8.6 task 2 / §9 and the M15 metrics contract §1.5–§1.6, §2
// (pure formatting): the title `Run summary — seed 7 — 35:12 played`; the
// rows lifetime earned / deliveries (on-time %) / first delivery · catch (by
// whom) / levels 2 · 3 · 4 · 5 / Victory (+ endless) / v3 Cards (decisions ·
// news, jobs out — D-M15-1) / Stories (finished · longest) / Longest quiet
// (the ramp window's longest gap between beats, `so far` while open) /
// malware spawned · caught · missed / lives lost (`· 2 by cards`; label +
// what explains each: counter machine, sorter call, cleared by you, the ship
// has sailed, a card's `chose: <option>`) / fleet bought / hires · fired ·
// ads / quests offered · done · failed / sorter calls · wrong / overseas
// cleared · malware / machines · docks · desks / taps per min · fps p50 ·
// p5; the fun bar 3 checklist (1)-(7) as ticks / crosses / you judge / not
// yet from the same object, every state of every item; the helpers
// (thinkMedian, rampWindow, longestQuiet, storiesOf, lifeExplained); the
// plain text `Copy summary` puts on the clipboard; the row pitch that keeps
// the card inside 360×604 (21 rows, 0 px spare — pinned); and every label,
// detail and value against the real m5x7 advance widths. Phaser is stubbed
// (the module imports the Button kit).
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

const sc = await import('../../src/ui/SummaryCard.ts')
const fb = await import('../../src/metrics/funBar.ts')
const { LINE_H } = await import('../../src/ui/text.ts')
const { dataFixture } = await import('../sim/helpers.ts')
type Playtest = import('../../src/metrics/playtest.ts').Playtest
type PlaytestHire = import('../../src/metrics/playtest.ts').PlaytestHire
type PlaytestChoice = import('../../src/metrics/playtest.ts').PlaytestChoice
type PlaytestLifeLost = import('../../src/metrics/playtest.ts').PlaytestLifeLost
type PlaytestBeat = import('../../src/metrics/playtest.ts').PlaytestBeat
type PlaytestEvents = import('../../src/metrics/playtest.ts').PlaytestEvents

const { funBar, FUN_TARGETS } = fb
const data = dataFixture()
const targets = FUN_TARGETS

// ---- fixtures ---------------------------------------------------------------------

function choice(over: Partial<PlaytestChoice> = {}): PlaytestChoice {
  return {
    id: 'ev_staff_training',
    kind: 'decision',
    title: 'Scanner course',
    option: 1,
    label: 'Send Mo',
    default: false,
    atS: 230,
    thinkS: 6,
    chain: null,
    ...over,
  }
}

const HEAD = 'ev_city_union'
const STORY = 'The Union Drive'
const link = (depth: number, end = false) => ({
  head: HEAD,
  title: STORY,
  depth,
  end,
})

/**
 * The example's ten choices: six decisions (four off the default; one a
 * four-card chain, its last card closing it), two news OKs, two job cards.
 * Think times: decisions 6 9 12 4 8 3, jobs 5 9 → median 7 (news 1.5, 2
 * left out).
 */
const CHOICES: PlaytestChoice[] = [
  choice(),
  choice({
    id: HEAD,
    title: STORY,
    option: 0,
    label: 'Talk to them',
    atS: 320,
    thinkS: 9,
    chain: link(1),
  }),
  choice({
    id: 'ev_city_union_picket',
    title: STORY,
    option: 1,
    label: 'Pay the fine',
    atS: 410,
    thinkS: 12,
    chain: link(2),
  }),
  choice({
    kind: 'news',
    id: 'ev_city_parade',
    title: 'Parade day',
    option: 0,
    label: 'OK',
    default: true,
    atS: 470,
    thinkS: 1.5,
  }),
  choice({
    kind: 'job',
    id: 'job:rush_district',
    title: 'Rush hour',
    option: 0,
    label: 'Accept',
    atS: 520,
    thinkS: 5,
  }),
  choice({
    id: 'ev_city_union_wait',
    title: STORY,
    option: 0,
    label: 'Wait it out',
    default: true,
    atS: 655,
    thinkS: 4,
    chain: link(3),
  }),
  choice({
    id: 'ev_city_union_deal',
    title: STORY,
    option: 0,
    label: 'Sign the deal',
    atS: 790,
    thinkS: 8,
    chain: link(4, true),
  }),
  choice({
    kind: 'news',
    id: 'ev_luck_rain',
    title: 'Rain all day',
    option: 0,
    label: 'OK',
    default: true,
    atS: 900,
    thinkS: 2,
  }),
  choice({
    id: 'ev_staff_lunch',
    title: 'Team lunch',
    option: 1,
    label: 'Skip it',
    default: true,
    atS: 1010,
    thinkS: 3,
  }),
  choice({
    kind: 'job',
    id: 'job:big_haul',
    title: 'Big haul',
    option: 1,
    label: 'Decline',
    default: true,
    atS: 1150,
    thinkS: 9,
  }),
]

/**
 * Beats with one known quiet of 0:48 (360 → 408) inside the ramp window
 * 3:00–10:12 (L2 at 612): 180 → 200 and 600 → 612 are shorter; 150 sits
 * before the window and the later ones after it.
 */
const BEATS: PlaytestBeat[] = [
  { atS: 150, kind: 'hold' },
  { atS: 200, kind: 'hold' },
  { atS: 230, kind: 'decision' },
  { atS: 270, kind: 'hold' },
  { atS: 300, kind: 'hold' },
  { atS: 320, kind: 'decision' },
  { atS: 360, kind: 'hold' },
  { atS: 408, kind: 'hold' },
  { atS: 410, kind: 'decision' },
  { atS: 450, kind: 'hold' },
  { atS: 470, kind: 'news' },
  { atS: 495, kind: 'hold' },
  { atS: 520, kind: 'job' },
  { atS: 560, kind: 'hold' },
  { atS: 600, kind: 'quest' },
  { atS: 612, kind: 'level' },
  { atS: 655, kind: 'decision' },
  { atS: 790, kind: 'decision' },
  { atS: 961, kind: 'level' },
]

/** Hold beats at these sim seconds. */
const holds = (...at: number[]): PlaytestBeat[] =>
  at.map((atS) => ({ atS, kind: 'hold' }))

/** Three beats with a `g`-second quiet between the first two (from 200). */
const gap = (g: number): PlaytestBeat[] => [
  { atS: 200, kind: 'hold' },
  { atS: 200 + g, kind: 'decision' },
  { atS: 300 + g, kind: 'hold' },
]

function events(over: Partial<PlaytestEvents> = {}): PlaytestEvents {
  return {
    offered: 11,
    decided: 10,
    byCategory: { staff: 2, city: 5, luck: 1, job: 2 },
    choices: CHOICES.map((c) => ({
      ...c,
      chain: c.chain ? { ...c.chain } : null,
    })),
    thinkMedianS: 7,
    chainsStarted: 1,
    chainsFinished: 1,
    chainsRunning: 0,
    livesLost: 2,
    livesGained: 0,
    vehiclesLost: 0,
    workersLost: 0,
    gameOverByEvent: 0,
    modifiersPeak: 3,
    ...over,
  }
}

function life(
  label: string,
  counter: string | null,
  cleared: boolean,
  more: { sorter?: string; hub?: string } = {},
): PlaytestLifeLost {
  return {
    parcelId: null,
    atS: 600,
    label,
    strain: 'metal',
    laneRate: 0.85,
    counter,
    clearedByPlayer: cleared,
    sorter: more.sorter ?? null,
    hub: more.hub ?? null,
    cause: 'malware',
    eventId: null,
    option: null,
    livesLeft: null,
  }
}

/** A life a card took: the card's title as the label, the option chosen. */
function cardLife(
  title: string,
  option: string | null,
  livesLeft: number,
  eventId = 'ev_sec_recall',
): PlaytestLifeLost {
  return {
    parcelId: null,
    atS: 1404.5,
    label: title,
    strain: null,
    laneRate: 0,
    counter: null,
    clearedByPlayer: false,
    sorter: null,
    hub: null,
    cause: 'event',
    eventId,
    option,
    livesLeft,
  }
}

function hire(over: Partial<PlaytestHire> = {}): PlaytestHire {
  return {
    role: 'driver',
    pips: { speed: 3, energy: 2, charisma: 0 },
    salary: 7,
    star: false,
    atS: 0,
    cheapest: true,
    ...over,
  }
}

/** The plan's illustrative profile (§12.9), a 35-minute v3 run. */
function example(over: Partial<Playtest> = {}): Playtest {
  return {
    version: 3,
    buildStamp: 'a1b2c3d 2026-10-31',
    seed: 7,
    startedAt: '2026-10-31T18:02:11Z',
    device: {
      ua: 'iPhone',
      cssW: 393,
      cssH: 852,
      dpr: 3,
      zoom: 1,
      maxTexture: 8192,
    },
    elapsedS: 2112,
    simS: 2100,
    pausedS: 311,
    firstDeliveryS: 47,
    firstMalware: {
      spawnedS: 121,
      caughtS: 158,
      by: 'inspector',
      tossedS: 166,
    },
    level2AtS: 612,
    level3AtS: 961,
    level4AtS: 1200,
    level5AtS: null,
    victoryAtS: null,
    endlessS: null,
    truckBoughtS: 660,
    deliveries: {
      total: 261,
      onTime: 225,
      late: 36,
      byType: { bike: 161, van: 40, truck: 60 },
    },
    moneyPerMin: [20, 48, 70, 72, 95, 140, 150, 160, 155, 170, 190, 200],
    lifetimeEarned: 9810,
    balanceEnd: 410,
    malware: { spawned: 24, caught: 21, missed: 1, tossedClean: 3, cleared: 0 },
    livesLost: [
      {
        ...life('l0dash', 'metal_detector', false),
        parcelId: 41,
        atS: 612,
        livesLeft: 3,
      },
      cardLife('The recall', 'Take the strike', 2),
      cardLife(
        'The registry acts',
        'Take the strike',
        1,
        'ev_sec_breach_strike',
      ),
    ],
    vehiclesBought: [
      { type: 'bike', atS: 0 },
      { type: 'bike', atS: 281 },
      { type: 'truck', atS: 660 },
    ],
    inspectorsHired: 1,
    machinesBought: [
      { id: 'metal_detector', atS: 9 },
      { id: 'shaky_shaker', atS: 830 },
    ],
    docksBought: [{ index: 2, atS: 1250 }],
    desks: 2,
    hires: [
      hire({ role: 'driver', cheapest: true }),
      hire({ role: 'driver', atS: 281, cheapest: false }),
      hire({ role: 'inspector', atS: 1300, cheapest: true }),
    ],
    fired: 1,
    adsPosted: 2,
    sorter: { decisions: 14, wrong: 2, clearedMalware: 1 },
    quests: {
      offered: 9,
      accepted: 6,
      declined: 2,
      completed: 4,
      failed: 2,
      firstCompletedS: 560,
      byTemplate: {
        rush_district: {
          offered: 3,
          accepted: 3,
          declined: 0,
          completed: 2,
          failed: 1,
        },
      },
    },
    overseas: { handedOff: 14, cleared: 12, malwareAtClearance: 0 },
    taps: 588,
    tapsPerMin: 16.7,
    rushTaps: 9,
    viewSwitches: 34,
    warehouseS: 603,
    fps: { p50: 59, p5: 41, min: 22, samples: 2112 },
    holdBayEvents: 37,
    holdBayEventsPer10Min: 10.6,
    stalls: { count: 2, totalS: 31 },
    payroll: { paid: 35, short: 0, walkouts: 0 },
    satisfactionEnd: { highres: 84, downtown: 71 },
    events: events(),
    beats: BEATS.map((b) => ({ ...b })),
    ...over,
  }
}

function state(pt: Playtest, opened: number | null = null) {
  return funBar(pt, targets, opened).map((c) => c.state)
}

/** Item `n` of fun bar 3 for `pt`. */
function item(pt: Playtest, n: number, opened: number | null = null) {
  const c = funBar(pt, targets, opened).find((x) => x.n === n)
  if (!c) throw new Error(`no fun bar item ${n}`)
  return { state: c.state, detail: c.detail }
}

/** The example with its events patched (choices replace the list). */
function withEvents(over: Partial<PlaytestEvents>, pt: Partial<Playtest> = {}) {
  return example({ events: events(over), ...pt })
}

// ---- title and rows ------------------------------------------------------------

describe('§12.9 title: `Run summary — seed 7 — 35:12 played`', () => {
  it('uses the wall time played (elapsedS) as m:ss', () => {
    expect(sc.summaryTitle(example())).toBe(
      'Run summary — seed 7 — 35:12 played',
    )
    expect(sc.summaryTitle(example({ seed: 12345, elapsedS: 59.9 }))).toBe(
      'Run summary — seed 12345 — 0:59 played',
    )
    expect(sc.summaryTitle(example({ elapsedS: 3725 }))).toBe(
      'Run summary — seed 7 — 62:05 played',
    )
  })
})

describe('plan-build3 §8.6 task 2: the v3 rows, in order', () => {
  it('lists every row with its value (Cards, Stories, Longest quiet; a card took two lives)', () => {
    expect(sc.summaryRows(example(), data)).toEqual([
      { label: 'Lifetime earned', value: '$9,810' },
      { label: 'Deliveries', value: '261 (86% on time)' },
      { label: 'First delivery · catch', value: '0:47 · 2:38 Inspector' },
      { label: 'Level 2 · 3 · 4 · 5', value: '10:12 · 16:01 · 20:00 · —' },
      { label: 'Victory', value: 'not yet' },
      { label: 'Cards', value: '8 · 6 decisions · 2 news' },
      { label: 'Stories', value: '1 · longest 4 cards' },
      { label: 'Longest quiet', value: '48 s' },
      { label: 'Malware spawned · caught · missed', value: '24 · 21 · 1' },
      { label: 'Lives lost', value: '3 · 2 by cards' },
      { label: 'l0dash', value: 'Metal detector', sub: true },
      { label: 'The recall', value: 'chose: Take the strike', sub: true },
      {
        label: 'The registry acts',
        value: 'chose: Take the strike',
        sub: true,
      },
      { label: 'Fleet bought', value: '2 bikes, 1 truck' },
      { label: 'Hires · fired · ads', value: '3 · 1 · 2' },
      { label: 'Quests offered · done · failed', value: '9 · 4 · 2' },
      { label: 'Sorter calls · wrong', value: '14 · 2' },
      { label: 'Overseas cleared · malware', value: '12 · 0' },
      { label: 'Machines · docks · desks', value: '2 · 1 · 2' },
      { label: 'Taps/min · FPS p50 · p5', value: '16.7 · 59 · 41' },
    ])
  })

  it('Victory reads its time and the endless time since', () => {
    const rows = sc.summaryRows(
      example({ level5AtS: 1500, victoryAtS: 2040, endlessS: 60 }),
      data,
    )
    const v = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(v['Level 2 · 3 · 4 · 5']).toBe('10:12 · 16:01 · 20:00 · 25:00')
    expect(v['Victory']).toBe('34:00 · endless 1:00')
  })

  it('says `not yet` / `none` / `—` for what has not happened', () => {
    const rows = sc.summaryRows(
      example({
        simS: 170,
        firstDeliveryS: null,
        firstMalware: {
          spawnedS: null,
          caughtS: null,
          by: null,
          tossedS: null,
        },
        level2AtS: null,
        level3AtS: null,
        level4AtS: null,
        deliveries: {
          total: 0,
          onTime: 0,
          late: 0,
          byType: { bike: 0, van: 0, truck: 0 },
        },
        livesLost: [],
        vehiclesBought: [],
        fps: { p50: 0, p5: 0, min: 0, samples: 0 },
        events: events({
          choices: [],
          chainsStarted: 0,
          chainsFinished: 0,
          thinkMedianS: null,
        }),
        beats: [],
      }),
      data,
    )
    const v = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(v['Deliveries']).toBe('none yet')
    expect(v['First delivery · catch']).toBe('not yet · not yet')
    expect(v['Level 2 · 3 · 4 · 5']).toBe('— · — · — · —')
    expect(v['Victory']).toBe('not yet')
    expect(v['Cards']).toBe('none yet')
    expect(v['Stories']).toBe('none yet')
    expect(v['Longest quiet']).toBe('—')
    expect(v['Lives lost']).toBe('none')
    expect(v['Fleet bought']).toBe('none')
    expect(v['Taps/min · FPS p50 · p5']).toBe('16.7 · —')
  })

  it('names the catching machine; the fleet by type in vehicles.json order', () => {
    expect(sc.checkerName(data, 'metal_detector')).toBe('Metal detector')
    expect(sc.checkerName(data, 'shaky_shaker')).toBe('Shaky shaker')
    expect(sc.checkerName(data, 'inspector')).toBe('Inspector')
    expect(
      sc.fleetLine(
        [
          { type: 'truck' },
          { type: 'bike' },
          { type: 'van' },
          { type: 'bike' },
        ],
        data,
      ),
    ).toBe('2 bikes, 1 van, 1 truck')
    expect(
      sc.onTimePct({
        total: 3,
        onTime: 2,
        late: 1,
        byType: { bike: 3, van: 0, truck: 0 },
      }),
    ).toBe(67)
  })

  it('lists each lost life with what explains it (counter, sorter, Clear, a card), at most three', () => {
    const rows = sc.summaryRows(
      example({
        livesLost: [
          life('l0dash', 'metal_detector', true),
          life('faker@6.6.6', 'shaky_shaker', false, { sorter: 'Mo' }),
          cardLife('The recall', 'Take the strike', 2),
          life('cr0ss-env', 'metal_detector', false),
        ],
      }),
      data,
    )
    expect(rows.filter((r) => r.sub)).toEqual([
      { label: 'l0dash', value: 'Metal detector · cleared by you', sub: true },
      {
        label: 'faker@6.6.6',
        value: 'Shaky shaker · Mo: looks clean',
        sub: true,
      },
      { label: 'The recall', value: 'chose: Take the strike', sub: true },
      { label: '… and 1 more', value: '', sub: true },
    ])
    expect(rows.find((r) => r.label === 'Lives lost')?.value).toBe(
      '4 · 1 by a card',
    )
  })

  it('a malware loss: no counter, an overseas loss says the ship has sailed / the plane has left', () => {
    expect(
      sc.lifeLostValue(
        life('b4ttery', 'battery_checker', false, { hub: 'docks' }),
        data,
      ),
    ).toBe('Battery checker · the ship has sailed')
    expect(
      sc.lifeLostValue(life('d3nse', null, false, { hub: 'airport' }), data),
    ).toBe('no counter · the plane has left')
    expect(
      sc.lifeLostValue(life('pkg', null, false, { sorter: 'Pat' }), data),
    ).toBe('Pat: looks clean')
    expect(sc.lifeLostValue(life('evil-lodash', null, false), data)).toBe(
      'no counter',
    )
  })

  it('a card loss: `chose: <option>` first (`—` when the option is unknown)', () => {
    expect(
      sc.lifeLostValue(cardLife('Inside', 'Keep the scanners', 0), data),
    ).toBe('chose: Keep the scanners')
    expect(sc.lifeLostValue(cardLife('Inside', null, 0), data)).toBe('chose: —')
  })

  it('Lives lost: the count, then `· 1 by a card` / `· N by cards`', () => {
    expect(sc.livesLine([])).toBe('none')
    expect(sc.livesLine([life('a', null, false)])).toBe('1')
    expect(sc.livesLine([cardLife('t', 'o', 2)])).toBe('1 · 1 by a card')
    expect(
      sc.livesLine([
        life('a', null, false),
        cardLife('t', 'o', 2),
        cardLife('t', 'o', 1),
      ]),
    ).toBe('3 · 2 by cards')
  })
})

describe('v3 rows: Cards, Stories, Longest quiet (contract §2.1)', () => {
  it('Cards counts deck cards only (jobs stay on the Quests row); `1 decision` singular', () => {
    expect(sc.cardsLine(CHOICES)).toBe('8 · 6 decisions · 2 news')
    expect(sc.cardsLine([])).toBe('none yet')
    // Jobs alone are not cards (D-M15-1).
    expect(
      sc.cardsLine([choice({ kind: 'job' }), choice({ kind: 'job' })]),
    ).toBe('none yet')
    expect(sc.cardsLine([choice()])).toBe('1 · 1 decision · 0 news')
    expect(sc.cardsLine([choice({ kind: 'news', default: true })])).toBe(
      '1 · 0 decisions · 1 news',
    )
    const many = [
      ...Array.from({ length: 99 }, () => choice()),
      ...Array.from({ length: 1200 }, () => choice({ kind: 'news' })),
    ]
    expect(sc.cardsLine(many)).toBe('1,299 · 99 decisions · 1,200 news')
  })

  it('Stories: chains finished (pairs included) · the longest recorded story; the count alone for a late profile', () => {
    expect(sc.storiesLine(example())).toBe('1 · longest 4 cards')
    // A pair finished too: the stats count both, the longest is still 4.
    const pair = [
      ...CHOICES,
      choice({
        id: 'ev_x',
        chain: { head: 'ev_h', title: 'H', depth: 2, end: true },
      }),
    ]
    expect(
      sc.storiesLine(
        withEvents({ choices: pair, chainsStarted: 2, chainsFinished: 2 }),
      ),
    ).toBe('2 · longest 4 cards')
    // The profile attached after the stories: no chain choices recorded.
    expect(sc.storiesLine(withEvents({ choices: [], chainsFinished: 3 }))).toBe(
      '3',
    )
    expect(sc.storiesLine(withEvents({ chainsFinished: 0 }))).toBe('none yet')
  })

  it('Longest quiet: `48 s` under a minute, `1:12` from one, `so far` while the window is open, `—` before 3:00', () => {
    expect(sc.quietLine(example())).toBe('48 s')
    expect(sc.quietText(48)).toBe('48 s')
    expect(sc.quietText(59.9)).toBe('59 s')
    expect(sc.quietText(60)).toBe('1:00')
    expect(sc.quietText(72)).toBe('1:12')
    // L2 not reached, 8:00 played: the window is 3:00–8:00 and still open;
    // the beats here stop at 8:00, the last one at 7:50.
    const open = example({
      simS: 480,
      level2AtS: null,
      level3AtS: null,
      beats: BEATS.filter((b) => b.atS <= 480),
    })
    expect(sc.quietLine(open)).toBe('48 s so far')
    // No beat since 7:50 by 9:10: the open edge is the quiet.
    expect(sc.quietLine({ ...open, simS: 550 })).toBe('1:20 so far')
    // Past 11:00 without L2: the window closes at 11:00 (D-M15-2).
    expect(sc.quietLine({ ...open, simS: 700 })).toBe('3:10')
    expect(sc.quietLine({ ...open, simS: 179 })).toBe('—')
    // L2 before 3:00 (no ramp at all).
    expect(sc.quietLine(example({ level2AtS: 170 }))).toBe('—')
    // No beat at all in a closed window: the whole window.
    expect(sc.quietLine(example({ beats: [] }))).toBe('7:12')
  })
})

// ---- the helpers ----------------------------------------------------------------

describe('fun bar 3 helpers (contract §1.5)', () => {
  it('thinkMedian: decisions + jobs (news left out), odd and even counts, one decimal; null with none', () => {
    expect(fb.thinkMedian(CHOICES)).toBe(7)
    expect(fb.thinkMedian([])).toBeNull()
    expect(fb.thinkMedian([choice({ kind: 'news', thinkS: 4 })])).toBeNull()
    expect(
      fb.thinkMedian([
        choice({ thinkS: 3 }),
        choice({ thinkS: 11.2 }),
        choice({ kind: 'job', thinkS: 2 }),
      ]),
    ).toBe(3)
    expect(
      fb.thinkMedian([
        choice({ thinkS: 1.1 }),
        choice({ thinkS: 2.2 }),
        choice({ kind: 'news', thinkS: 90 }),
      ]),
    ).toBe(1.7)
    expect(fb.thinkMedian([choice({ thinkS: 0 }), choice({ thinkS: 0 })])).toBe(
      0,
    )
  })

  it('rampWindow (D-M15-2): to the L2 tick once reached, else to min(simS, 11:00), open until then', () => {
    expect(fb.rampWindow(example())).toEqual({
      fromS: 180,
      toS: 612,
      open: false,
    })
    expect(fb.rampWindow(example({ level2AtS: 600 }))).toEqual({
      fromS: 180,
      toS: 600,
      open: false,
    })
    expect(fb.rampWindow(example({ level2AtS: null, simS: 500 }))).toEqual({
      fromS: 180,
      toS: 500,
      open: true,
    })
    expect(fb.rampWindow(example({ level2AtS: null, simS: 660 }))).toEqual({
      fromS: 180,
      toS: 660,
      open: false,
    })
    expect(fb.rampWindow(example({ level2AtS: null, simS: 2100 }))).toEqual({
      fromS: 180,
      toS: 660,
      open: false,
    })
    // A later L2 than 11:00 still bounds the window (the plan's bound wins).
    expect(fb.rampWindow(example({ level2AtS: 750 })).toS).toBe(750)
  })

  it('longestQuiet: the edges count, beats outside the window do not, no beats = the window, empty window = null', () => {
    expect(fb.longestQuiet(BEATS, 180, 612)).toBe(48)
    expect(fb.longestQuiet([], 180, 612)).toBe(432)
    expect(fb.longestQuiet(holds(100, 700), 180, 612)).toBe(432)
    // fromS → the first beat and the last beat → toS are gaps too.
    expect(fb.longestQuiet(holds(300, 320), 180, 340)).toBe(120)
    expect(fb.longestQuiet(holds(200, 220), 180, 340)).toBe(120)
    // Beats on the edges belong to the window.
    expect(fb.longestQuiet(holds(180, 240, 300), 180, 300)).toBe(60)
    // Unsorted input, tenths that drift when subtracted.
    expect(fb.longestQuiet(holds(412.3, 364.1, 200.2), 180, 420)).toBe(163.9)
    expect(fb.longestQuiet(holds(200), 300, 300)).toBeNull()
    expect(fb.longestQuiet(holds(200), 300, 200)).toBeNull()
  })

  it('storiesOf: the choices that closed a chain, oldest first (copies)', () => {
    const s = fb.storiesOf(CHOICES)
    expect(s).toEqual([{ head: HEAD, title: STORY, depth: 4, end: true }])
    s[0]!.depth = 9
    expect(CHOICES[6]?.chain?.depth).toBe(4)
    expect(fb.storiesOf([])).toEqual([])
    expect(
      fb
        .storiesOf([
          choice({ chain: { head: 'a', title: 'A', depth: 2, end: true } }),
          choice({ chain: { head: 'b', title: 'B', depth: 1, end: false } }),
          choice({ chain: { head: 'c', title: 'C', depth: 3, end: true } }),
        ])
        .map((c) => c.head),
    ).toEqual(['a', 'c'])
  })

  it('lifeExplained: a counter, a sorter, a Clear, or a card with its option', () => {
    expect(fb.lifeExplained(life('a', 'metal_detector', false))).toBe(true)
    expect(fb.lifeExplained(life('a', null, false, { sorter: 'Mo' }))).toBe(
      true,
    )
    expect(fb.lifeExplained(life('a', null, true))).toBe(true)
    expect(fb.lifeExplained(life('a', null, false, { hub: 'docks' }))).toBe(
      false,
    )
    expect(fb.lifeExplained(cardLife('The recall', 'Take the strike', 2))).toBe(
      true,
    )
    expect(fb.lifeExplained(cardLife('The recall', null, 2))).toBe(false)
  })
})

// ---- fun bar 3 ----------------------------------------------------------------

describe('plan-build3 §9 fun bar 3: ticks, crosses, you judge, not yet', () => {
  it('reads the example: 4 off the default (you judge), a 0:48 quiet, L2 / L3 on time, a 4-card story (you judge), 35 min, every life explained, no Victory by 35:00 yet', () => {
    const checks = funBar(example(), targets)
    expect(checks.map((c) => [c.n, c.state, c.detail])).toEqual([
      [1, 'judge', '4 not default · you judge'],
      [2, 'pass', 'gap 0:48 · think 7 s'],
      [3, 'pass', 'L2 10:12 · L3 16:01'],
      [4, 'judge', '1 of 3+ · you judge'],
      [5, 'pass', 'summary at 35:12'],
      [6, 'pass', 'all 3 explained'],
      [7, 'pending', 'not yet'],
    ])
    expect(checks.map((c) => c.label)).toEqual([
      'Decisions felt like mine',
      'Never idle on the ramp',
      'L2 by 10:30, L3 by 16:30',
      'A story (3+ cards)',
      'Kept playing past 25:00',
      'Every lost life explained',
      'Stretch: Golden Release by 36:00',
    ])
    expect(sc.summaryChecks(example())).toEqual(checks)
  })

  it('the targets are plan-build3 §9 (instrumentation, D-M15-9)', () => {
    expect(FUN_TARGETS).toEqual({
      nonDefault: 3,
      rampFromS: 180,
      rampToS: 660,
      rampGapS: 90,
      thinkMedianS: 15,
      level2ByS: 630,
      level3ByS: 990,
      storyCards: 3,
      keepPlayingS: 1500,
      stretchS: 2160,
    })
  })

  it('(1) counts decision cards only: a job Accept or a news OK never counts (D-M15-3)', () => {
    const jobs = [
      choice({ kind: 'job', label: 'Accept' }),
      choice({ kind: 'job', label: 'Accept' }),
      choice({ kind: 'job', label: 'Accept' }),
      choice({ kind: 'news', label: 'OK' }),
    ]
    expect(item(withEvents({ choices: jobs }), 1)).toEqual({
      state: 'pending',
      detail: 'no cards yet',
    })
    expect(item(withEvents({ choices: [] }), 1)).toEqual({
      state: 'pending',
      detail: 'no cards yet',
    })
    const two = [...jobs, choice(), choice(), choice({ default: true })]
    expect(item(withEvents({ choices: two }), 1)).toEqual({
      state: 'fail',
      detail: '2 not default',
    })
    const allDefault = [choice({ default: true })]
    expect(item(withEvents({ choices: allDefault }), 1)).toEqual({
      state: 'fail',
      detail: '0 not default',
    })
    expect(item(withEvents({ choices: [...two, choice()] }), 1)).toEqual({
      state: 'judge',
      detail: '3 not default · you judge',
    })
  })

  it('(2) the ramp: open → not yet; a quiet over 1:30 → cross; ≤ 1:30 → tick, unless think ≥ 15 s → you judge (soft, never a cross)', () => {
    // L2 not reached at 8:00: the window is still open.
    expect(
      item(example({ level2AtS: null, level3AtS: null, simS: 480 }), 2),
    ).toEqual({
      state: 'pending',
      detail: 'not yet',
    })
    // L2 not reached by 11:00: the window closes there (D-M15-2) — 612 → 660.
    expect(
      item(example({ level2AtS: null, level3AtS: null, simS: 700 }), 2),
    ).toEqual({
      state: 'pass',
      detail: 'gap 0:48 · think 7 s',
    })
    // A 1:30 quiet passes, 1:31 fails.
    expect(item(example({ level2AtS: 380, beats: gap(90) }), 2)).toEqual({
      state: 'pass',
      detail: 'gap 1:30 · think 7 s',
    })
    expect(item(example({ level2AtS: 380, beats: gap(91) }), 2)).toEqual({
      state: 'fail',
      detail: 'gap 1:31 · think 7 s',
    })
    // The think half is soft: it turns a tick into `you judge`…
    expect(item(withEvents({ thinkMedianS: 15 }), 2)).toEqual({
      state: 'judge',
      detail: 'gap 0:48 · think 15 s',
    })
    expect(item(withEvents({ thinkMedianS: 14.9 }), 2).state).toBe('pass')
    // …and never a cross into anything else.
    expect(
      item(
        withEvents({ thinkMedianS: 40 }, { level2AtS: 380, beats: gap(91) }),
        2,
      ).state,
    ).toBe('fail')
    // No think time (no decision or job yet): the gap decides.
    expect(item(withEvents({ thinkMedianS: null }), 2)).toEqual({
      state: 'pass',
      detail: 'gap 0:48 · think —',
    })
    // L2 before 3:00: no ramp to be idle on.
    expect(item(example({ level2AtS: 170 }), 2)).toEqual({
      state: 'pass',
      detail: 'gap — · think 7 s',
    })
    // The policy fixture: think 0 (the policy decides on its step).
    expect(item(withEvents({ thinkMedianS: 0 }), 2).detail).toBe(
      'gap 0:48 · think 0 s',
    )
  })

  it('(3) L2 by 10:30 and L3 by 16:30: late or past the bound unreached → cross, still open → not yet', () => {
    expect(item(example({ level2AtS: 630, level3AtS: 990 }), 3)).toEqual({
      state: 'pass',
      detail: 'L2 10:30 · L3 16:30',
    })
    expect(item(example({ level2AtS: 631 }), 3)).toEqual({
      state: 'fail',
      detail: 'L2 10:31 · L3 16:01',
    })
    expect(item(example({ level3AtS: 991 }), 3).state).toBe('fail')
    // L2 on time, L3 not reached at 15:00: still open.
    expect(item(example({ simS: 900, level3AtS: null }), 3)).toEqual({
      state: 'pending',
      detail: 'L2 10:12 · L3 —',
    })
    // L3 not reached past 16:30.
    expect(item(example({ simS: 991, level3AtS: null }), 3).state).toBe('fail')
    // Neither reached at 10:00; L2 not reached at 10:31 (L3 still open).
    expect(
      item(example({ simS: 600, level2AtS: null, level3AtS: null }), 3),
    ).toEqual({ state: 'pending', detail: 'L2 — · L3 —' })
    expect(
      item(example({ simS: 631, level2AtS: null, level3AtS: null }), 3).state,
    ).toBe('fail')
  })

  it('(4) a story of 3+ cards → you judge; under way → not yet; pairs only or none → cross (D-M15-4)', () => {
    const pair = (head: string): PlaytestChoice[] => [
      choice({ id: head, chain: { head, title: 'H', depth: 1, end: false } }),
      choice({
        id: `${head}_2`,
        chain: { head, title: 'H', depth: 2, end: true },
      }),
    ]
    expect(
      item(
        withEvents({ choices: pair('a'), chainsStarted: 1, chainsFinished: 1 }),
        4,
      ),
    ).toEqual({ state: 'fail', detail: 'pairs only' })
    expect(
      item(
        withEvents({
          choices: [...pair('a'), ...pair('b').slice(0, 1)],
          chainsStarted: 2,
          chainsFinished: 1,
          chainsRunning: 1,
        }),
        4,
      ),
    ).toEqual({ state: 'pending', detail: '1 under way' })
    // Review sim-1: a link dropped on its cond ends a chain unfinished —
    // started > finished with nothing running is not `under way`.
    expect(
      item(
        withEvents({
          choices: [...pair('a'), ...pair('b').slice(0, 1)],
          chainsStarted: 2,
          chainsFinished: 1,
          chainsRunning: 0,
        }),
        4,
      ),
    ).toEqual({ state: 'fail', detail: 'pairs only' })
    expect(
      item(
        withEvents({
          choices: pair('b').slice(0, 1),
          chainsStarted: 1,
          chainsFinished: 0,
          chainsRunning: 0,
        }),
        4,
      ),
    ).toEqual({ state: 'fail', detail: 'none finished' })
    expect(
      item(
        withEvents({
          choices: [choice()],
          chainsStarted: 0,
          chainsFinished: 0,
        }),
        4,
      ),
    ).toEqual({ state: 'fail', detail: 'none finished' })
    // A 3-card chain is enough; two of them read `2 of 3+`.
    const three = (head: string): PlaytestChoice[] => [
      ...pair(head).slice(0, 1),
      choice({
        id: `${head}_2`,
        chain: { head, title: 'H', depth: 2, end: false },
      }),
      choice({
        id: `${head}_3`,
        chain: { head, title: 'H', depth: 3, end: true },
      }),
    ]
    expect(
      item(
        withEvents({
          choices: three('a'),
          chainsStarted: 1,
          chainsFinished: 1,
        }),
        4,
      ),
    ).toEqual({ state: 'judge', detail: '1 of 3+ · you judge' })
    expect(
      item(
        withEvents({
          choices: [...three('a'), ...three('b'), ...pair('c').slice(0, 1)],
          chainsStarted: 3,
          chainsFinished: 2,
        }),
        4,
      ),
    ).toEqual({ state: 'judge', detail: '2 of 3+ · you judge' })
  })

  it('(5) played past 25:00 before the summary first opened', () => {
    expect(state(example())[4]).toBe('pass') // 35:12
    expect(state(example({ elapsedS: 1500 }))[4]).toBe('fail')
    // Opened at 20:00, reopened at 35:12: the first opening counts.
    expect(state(example(), 1200)[4]).toBe('fail')
    expect(item(example(), 5, 1200).detail).toBe('summary at 20:00')
  })

  it('(6) every lost life explained — a card and its option count; a data tick, not a judge (D-M15-8)', () => {
    expect(item(example({ livesLost: [] }), 6)).toEqual({
      state: 'pass',
      detail: 'none lost',
    })
    expect(
      item(
        example({ livesLost: [cardLife('The recall', 'Take the strike', 2)] }),
        6,
      ),
    ).toEqual({
      state: 'pass',
      detail: 'all 1 explained',
    })
    expect(
      item(
        example({
          livesLost: [
            life('pkg', null, false, { sorter: 'Mo' }),
            life('pkg2', null, true),
          ],
        }),
        6,
      ),
    ).toEqual({ state: 'pass', detail: 'all 2 explained' })
    expect(
      item(
        example({
          livesLost: [
            life('mystery', null, false, { hub: 'docks' }),
            cardLife('The recall', null, 2),
            cardLife('The recall', 'Take the strike', 1),
          ],
        }),
        6,
      ),
    ).toEqual({ state: 'fail', detail: '2 unexplained' })
  })

  it('(7) stretch: the Golden Release by 36:00', () => {
    expect(item(example({ victoryAtS: 2160, endlessS: 0 }), 7)).toEqual({
      state: 'pass',
      detail: 'Victory 36:00',
    })
    expect(
      item(example({ simS: 2400, victoryAtS: 2161, endlessS: 239 }), 7),
    ).toEqual({
      state: 'fail',
      detail: 'Victory 36:01',
    })
    expect(item(example({ simS: 2161 }), 7)).toEqual({
      state: 'fail',
      detail: 'none by 36:00',
    })
    expect(item(example({ simS: 2160 }), 7)).toEqual({
      state: 'pending',
      detail: 'not yet',
    })
  })

  it('a fresh profile: everything still open but the played time', () => {
    const fresh = example({
      elapsedS: 30,
      simS: 30,
      level2AtS: null,
      level3AtS: null,
      level4AtS: null,
      livesLost: [],
      events: events({
        offered: 0,
        decided: 0,
        choices: [],
        thinkMedianS: null,
        chainsStarted: 0,
        chainsFinished: 0,
      }),
      beats: [],
    })
    expect(state(fresh)).toEqual([
      'pending',
      'pending',
      'pending',
      'fail',
      'fail',
      'pass',
      'pending',
    ])
  })
})

describe('§12.9 `Copy summary`: the card as plain text', () => {
  it('title, rows, the fun bar 3 checklist with marks, build and device', () => {
    const pt = example()
    const text = sc.summaryText(pt, data, sc.summaryChecks(pt))
    expect(text.split('\n')).toEqual([
      'Run summary — seed 7 — 35:12 played',
      'Lifetime earned: $9,810',
      'Deliveries: 261 (86% on time)',
      'First delivery · catch: 0:47 · 2:38 Inspector',
      'Level 2 · 3 · 4 · 5: 10:12 · 16:01 · 20:00 · —',
      'Victory: not yet',
      'Cards: 8 · 6 decisions · 2 news',
      'Stories: 1 · longest 4 cards',
      'Longest quiet: 48 s',
      'Malware spawned · caught · missed: 24 · 21 · 1',
      'Lives lost: 3 · 2 by cards',
      '  - l0dash: Metal detector',
      '  - The recall: chose: Take the strike',
      '  - The registry acts: chose: Take the strike',
      'Fleet bought: 2 bikes, 1 truck',
      'Hires · fired · ads: 3 · 1 · 2',
      'Quests offered · done · failed: 9 · 4 · 2',
      'Sorter calls · wrong: 14 · 2',
      'Overseas cleared · malware: 12 · 0',
      'Machines · docks · desks: 2 · 1 · 2',
      'Taps/min · FPS p50 · p5: 16.7 · 59 · 41',
      'Fun bar 3:',
      '[?] 1. Decisions felt like mine (4 not default · you judge)',
      '[x] 2. Never idle on the ramp (gap 0:48 · think 7 s)',
      '[x] 3. L2 by 10:30, L3 by 16:30 (L2 10:12 · L3 16:01)',
      '[?] 4. A story (3+ cards) (1 of 3+ · you judge)',
      '[x] 5. Kept playing past 25:00 (summary at 35:12)',
      '[x] 6. Every lost life explained (all 3 explained)',
      '[-] 7. Stretch: Golden Release by 36:00 (not yet)',
      'Build a1b2c3d 2026-10-31 · started 2026-10-31T18:02:11Z · 393×852 @3x zoom 1',
      'iPhone',
    ])
    expect(sc.funMark('pending')).toBe('[-]')
    expect(sc.funMark('fail')).toBe('[ ]')
  })
})

// ---- fit ---------------------------------------------------------------------------

describe('the card fits 360×604 (plan-build3 §8.6 task 2, contract §2.3)', () => {
  const checks = 7
  /** 360×604, safe insets 0: avail = 604. */
  const H = 604

  it('fun bar 3 has seven checks; the fixed part of the column is 286 px', () => {
    expect(funBar(example(), targets)).toHaveLength(checks)
    expect(sc.summaryBlockH(LINE_H, 0, checks)).toBe(286)
  })

  it('the rows keep 16 px up to 18 rows, close to 15 at 19 and LINE_H at 20–21; 21 rows fill 604 exactly', () => {
    const titleH = LINE_H
    expect(sc.summaryRowPitch(H, titleH, 17, checks)).toBe(16)
    expect(sc.summaryRowPitch(H, titleH, 18, checks)).toBe(16)
    expect(sc.summaryRowPitch(H, titleH, 19, checks)).toBe(15)
    expect(sc.summaryRowPitch(H, titleH, 20, checks)).toBe(LINE_H)
    expect(sc.summaryRowPitch(H, titleH, 21, checks)).toBe(LINE_H)
    for (let rows = 17; rows <= 21; rows++) {
      const pitch = sc.summaryRowPitch(H, titleH, rows, checks)
      expect(
        sc.summaryBlockH(titleH, rows, checks, pitch) + 2 * 12,
        `${rows} rows`,
      ).toBeLessThanOrEqual(H)
    }
    expect(sc.summaryBlockH(LINE_H, 21, checks, 14) + 24).toBe(604)
  })

  it('a two-line title on a shorter screen closes the rows up, never under one text line', () => {
    // 17 rows (no lost life): with fun bar 3's seventh check, 18 rows and a
    // two-line title need 590 (the title never wraps at 360 — the last test).
    const titleH = LINE_H
    for (const [avail, rows] of [
      [570, 17],
      [590, 18],
    ] as const) {
      const pitch = sc.summaryRowPitch(avail, 2 * titleH, rows, checks)
      expect(pitch).toBeLessThan(16)
      expect(pitch).toBeGreaterThanOrEqual(LINE_H)
      expect(
        sc.summaryBlockH(2 * titleH, rows, checks, pitch) + 2 * 12,
      ).toBeLessThanOrEqual(avail)
    }
    expect(sc.summaryRowPitch(300, titleH, 21, checks)).toBe(LINE_H)
  })

  it('17 base rows: none lost → 17, one → 18, the example (3) → 20, four or more → 21 (the most)', () => {
    expect(sc.summaryRows(example({ livesLost: [] }), data)).toHaveLength(17)
    expect(
      sc.summaryRows(
        example({ livesLost: [life('a', 'metal_detector', false)] }),
        data,
      ),
    ).toHaveLength(18)
    expect(sc.summaryRows(example(), data)).toHaveLength(20)
    const lives = (n: number) =>
      example({
        livesLost: Array.from({ length: n }, (_, i) =>
          cardLife(`c${i}`, 'o', 4 - i),
        ),
      })
    expect(sc.summaryRows(lives(4), data)).toHaveLength(21)
    expect(sc.summaryRows(lives(9), data)).toHaveLength(21)
  })

  it('at iPhone 16 (393×659) all 21 rows keep 16 px', () => {
    expect(sc.summaryRowPitch(659, LINE_H, 21, checks)).toBe(16)
  })
})

// ---- m5x7 widths (no browser) ------------------------------------------------------

const xml = readFileSync(
  new URL('../../src/assets/m5x7.xml', import.meta.url),
  'utf8',
)
const adv = new Map<number, number>()
for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
  adv.set(Number(m[1]), Number(m[2]))
const width = (s: string): number =>
  [...s].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 6), 0)
const glyphs = new Set(
  [...xml.matchAll(/<char id="(\d+)"/g)].map((m) => Number(m[1])),
)
const missing = (s: string): string[] =>
  [...s].filter((ch) => !glyphs.has(ch.codePointAt(0)!))

/** The column at 360: min(360 − 2 × 12, 340). */
const COL_W = 336
/** A fun row: label at +22, detail right-aligned, 8 px between them. */
const FUN_ROOM = COL_W - 30
/** A row value's cap (`colW − 32`); a lives entry is indented 12 more. */
const VALUE_MAX = COL_W - 32
const SUB_VALUE_MAX = VALUE_MAX - 12

const many = (n: number, f: (i: number) => PlaytestChoice) =>
  Array.from({ length: n }, (_, i) => f(i))

/** `n` card losses, with or without the option chosen. */
const lost = (n: number, explained: boolean) =>
  Array.from({ length: n }, (_, i) =>
    cardLife(`card ${i}`, explained ? 'Take the strike' : null, 0),
  )

/** Profiles at the edges of every detail: big counts, long clocks. */
function worstProfiles(): Playtest[] {
  const late = 7559 // 125:59
  const stories = many(36, (i) =>
    choice({
      chain: {
        head: `h${i % 12}`,
        title: 'H',
        depth: 1 + (i % 3),
        end: i % 3 === 2,
      },
    }),
  )
  return [
    example(),
    // (1) 12 off the default · (2) a 12:34 quiet, think 128 s · (3) late L2 /
    // L3 · (4) 12 stories · (5) 125:59 · (6) 12 explained · (7) a late Victory.
    example({
      elapsedS: late,
      simS: late,
      level2AtS: 180 + 754,
      level3AtS: late,
      victoryAtS: late,
      endlessS: 0,
      beats: [],
      livesLost: lost(12, true),
      events: events({
        choices: [...many(12, () => choice()), ...stories],
        thinkMedianS: 128,
        chainsStarted: 12,
        chainsFinished: 12,
      }),
    }),
    // (2) open · (3) — · (4) 12 under way · (6) 12 unexplained · (7) none.
    example({
      simS: 2400,
      level2AtS: null,
      level3AtS: null,
      livesLost: lost(12, false),
      events: events({
        choices: [],
        chainsStarted: 12,
        chainsFinished: 0,
        chainsRunning: 12,
      }),
    }),
    example({ simS: 500, level2AtS: null, level3AtS: null }),
  ]
}

describe('m5x7 fit: every fun bar label + detail and every row value at 360 (contract §1.6, §2.4)', () => {
  it('a fun row: label + 30 + its worst detail ≤ 336, in glyphs the font has', () => {
    for (const pt of worstProfiles())
      for (const c of funBar(pt, targets, pt.elapsedS)) {
        const w = width(c.label) + width(c.detail) + 30
        expect(w, `${c.n}. ${c.label} · ${c.detail}`).toBeLessThanOrEqual(COL_W)
        expect(missing(c.label + c.detail)).toEqual([])
      }
    // The contract's measured worst cases.
    expect(
      width('Stretch: Golden Release by 36:00') + width('none by 36:00'),
    ).toBe(242)
    expect(
      width('Decisions felt like mine') + width('12 not default · you judge'),
    ).toBe(260)
    expect(
      width('Never idle on the ramp') + width('gap 12:34 · think 128 s'),
    ).toBe(241)
    expect(width('12 not default · you judge')).toBeLessThan(FUN_ROOM)
    expect(width('Fun bar 3')).toBeLessThan(COL_W)
  })

  it('every row value ≤ colW − 32 (a lives entry 12 less), in glyphs the font has', () => {
    for (const pt of worstProfiles())
      for (const r of sc.summaryRows(pt, data)) {
        const max = r.sub ? SUB_VALUE_MAX : VALUE_MAX
        expect(width(r.value), `${r.label}: ${r.value}`).toBeLessThanOrEqual(
          max,
        )
        expect(missing(r.label + r.value)).toEqual([])
      }
    for (const v of [
      '123 · 99 decisions · 24 news',
      '12 · longest 12 cards',
      '12:34 so far',
      '12 · 11 by cards',
    ])
      expect(width(v), v).toBeLessThanOrEqual(VALUE_MAX)
    expect(width('123 · 99 decisions · 24 news')).toBe(149)
  })

  it('a card loss: the longest `chose: <option>` in the shipped deck still leaves room for the widest title', () => {
    let worstOption = ''
    let worstTitle = ''
    for (const e of data.events.deck) {
      if (width(e.title) > width(worstTitle)) worstTitle = e.title
      for (const o of e.options ?? []) {
        const label = o.label.replace(/\{\w+\}/g, 'Bartholomew')
        if (width(label) > width(worstOption)) worstOption = label
      }
    }
    const value = sc.lifeLostValue(cardLife(worstTitle, worstOption, 0), data)
    expect(width(value), value).toBeLessThanOrEqual(SUB_VALUE_MAX)
    // The sub label starts 12 in; 8 px between it and the value.
    const room = COL_W - 12 - width(value) - 8
    expect(
      width(worstTitle),
      `${worstTitle} beside ${value}`,
    ).toBeLessThanOrEqual(room)
    expect(missing(value + worstTitle)).toEqual([])
  })

  it('the title stays on one line at 360 (seed 4294967295, 125:59 played)', () => {
    const t = sc.summaryTitle(example({ seed: 4294967295, elapsedS: 7559 }))
    expect(width(t)).toBeLessThanOrEqual(COL_W)
  })
})
