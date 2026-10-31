// Build 3 M12 (B3 §3.3–§3.4; M12 contract §1, critique 5, 23, 24): the
// EventCard's pure text model under Node with the real m5x7 advance widths —
// the effects rows (the separator join, segment first, never a row that
// starts or ends with `·`, the tones as spans, an over-wide segment
// word-wrapped, the `…` cut on a third row), the greyed `Can't afford · $N`
// row, the flow wrap beside the picture then full width, the card heights of
// contract §1.4, the faces, Enter (never danger or greyed, D-M12-2), the
// option hit rects, the card rect at 360 × 604, 393 × 659 and 430 × 932, the
// shared helpers (eventChoiceLine, modifierIcon on world frames,
// timeLeftText) and every constant string in m5x7 glyphs.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODIFIER_KEYS } from '../../src/data/schema.ts'
import { inAtlas } from '../../src/render/frames.ts'
import type { EffectLine } from '../../src/sim/systems/effects.ts'
import type { EventOptionView } from '../../src/sim/view-api.ts'
import {
  EFFECT_TONE_TINT,
  EVENT_CANT_AFFORD,
  EVENT_CARD_MAX_H,
  EVENT_CARD_W,
  EVENT_DARK,
  EVENT_ENTER_DENY,
  EVENT_INSET_BOTTOM,
  EVENT_LABEL_PAD,
  EVENT_MUTED,
  EVENT_PAUSED_TEXT,
  EVENT_SEP,
  EVENT_TITLE_TINT,
  type EffectRow,
  type EventCardInput,
  disabledRow,
  effectRows,
  endsRun,
  eventCardMisfits,
  eventCardMode,
  eventCardRect,
  eventChoiceLine,
  eventColumn,
  layoutEventCard,
  lowerFirst,
  modifierIcon,
  timeLeftText,
  wrapFlow,
} from '../../src/ui/effectText.ts'
import { computeLayout } from '../../src/ui/layout.ts'
import { dataFixture } from '../sim/helpers.ts'

const data = dataFixture()

// ---- m5x7 metrics ---------------------------------------------------------------

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

const INNER = EVENT_CARD_W - 24
/** 180 px: two never share a line, one fits beside the picture (222). */
const W30 = 'x'.repeat(30)
const body = (k: number): string =>
  Array.from({ length: k }, () => W30).join(' ')
const cost = (text: string): EffectLine => ({ text, tone: 'cost' })
const gain = (text: string): EffectLine => ({ text, tone: 'gain' })
const neutral = (text: string): EffectLine => ({ text, tone: 'neutral' })
/** One row: a short cost. */
const ONE: EffectLine[] = [cost('−$150')]
/** Two rows: two 180-px segments never share a row. */
const TWO: EffectLine[] = [cost(W30), gain(W30)]

function opt(
  index: number,
  lines: readonly EffectLine[],
  extra: Partial<EventOptionView> = {},
): EventOptionView {
  return {
    index,
    label: `Option ${index}`,
    lines,
    cost: 0,
    default: false,
    danger: false,
    affordable: true,
    reason: null,
    ...extra,
  }
}

function card(extra: Partial<EventCardInput> = {}): EventCardInput {
  return {
    eventId: 'ev_test',
    kind: 'decision',
    word: 'STAFF',
    picture: 'ev_pic_staff',
    title: 'The gang',
    body: body(2),
    day: 3,
    parentChoice: null,
    options: [opt(0, ONE), opt(1, ONE)],
    ...extra,
  }
}

/** The row texts never start or end with the separator, and every span is inside its row. */
function wellFormed(rows: readonly EffectRow[]): void {
  for (const r of rows) {
    expect(r.text.startsWith('·'), r.text).toBe(false)
    expect(r.text.trimEnd().endsWith('·'), r.text).toBe(false)
    expect(r.text.startsWith(' '), r.text).toBe(false)
    let at = 0
    for (const s of r.spans) {
      expect(s.from).toBe(at)
      expect(s.len).toBeGreaterThan(0)
      at += s.len
    }
    expect(at).toBe(r.text.length)
    for (let i = 1; i < r.spans.length; i++)
      expect(r.spans[i]!.tone).not.toBe(r.spans[i - 1]!.tone)
  }
}

const toneAt = (r: EffectRow, i: number): string =>
  r.spans.find((s) => i >= s.from && i < s.from + s.len)?.tone ?? '?'

describe('B3 §3.3 effectRows: the generated line laid out (segment first)', () => {
  it('joins short segments with ` · `; spans carry the tones (cost red, gain green, the separator neutral)', () => {
    const r = effectRows([cost('−$150'), gain('+5 happiness')], INNER, width)
    expect(r.overflow).toBe(false)
    expect(r.rows.map((x) => x.text)).toEqual(['−$150 · +5 happiness'])
    expect(r.rows[0]!.spans).toEqual([
      { from: 0, len: 5, tone: 'cost' },
      { from: 5, len: 3, tone: 'neutral' },
      { from: 8, len: 12, tone: 'gain' },
    ])
    wellFormed(r.rows)
  })

  it('`…then:` lines are neutral; blank lines are dropped', () => {
    const r = effectRows(
      [
        cost('−$300'),
        neutral(''),
        neutral('…then: Gang on the doorstep (in 1 day)'),
      ],
      INNER,
      width,
    )
    expect(r.rows).toHaveLength(1)
    const row = r.rows[0]!
    expect(row.text).toBe('−$300 · …then: Gang on the doorstep (in 1 day)')
    expect(toneAt(row, 0)).toBe('cost')
    expect(toneAt(row, row.text.indexOf('…then'))).toBe('neutral')
    expect(row.spans.at(-1)).toEqual({
      from: 5,
      len: row.text.length - 5,
      tone: 'neutral',
    })
  })

  it('a segment that does not fit after the separator moves whole to row 2', () => {
    const a = 'x'.repeat(30) // 180
    const b = 'y'.repeat(16) // ≈ 100: 180 + 12 + 100 > 276
    const r = effectRows([cost(a), gain(b)], INNER, width)
    expect(r.rows.map((x) => x.text)).toEqual([a, b])
    expect(r.rows[1]!.spans).toEqual([{ from: 0, len: b.length, tone: 'gain' }])
    expect(r.overflow).toBe(false)
  })

  it('a segment wider than a row is word-wrapped: every word keeps its tone, the next row starts with a word', () => {
    const words = Array.from({ length: 10 }, () => 'xxxxx') // 10 × 30 + 9 × 5 = 345
    const r = effectRows([cost(words.join(' ')), gain('+1 life')], INNER, width)
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]!.text).toBe(words.slice(0, 8).join(' '))
    expect(r.rows[1]!.text).toBe('xxxxx xxxxx · +1 life')
    expect(r.rows[0]!.spans).toEqual([
      { from: 0, len: r.rows[0]!.text.length, tone: 'cost' },
    ])
    expect(toneAt(r.rows[1]!, 0)).toBe('cost')
    expect(toneAt(r.rows[1]!, r.rows[1]!.text.indexOf('+1'))).toBe('gain')
    for (const row of r.rows) expect(width(row.text)).toBeLessThanOrEqual(INNER)
    wellFormed(r.rows)
  })

  it('critique 23: a segment holding ` · ` is split there — no row starts or ends with the separator', () => {
    const reward = gain(
      'Reward: $500 · 5 satisfaction in Pasture Peer Fields · ★ inspector Bartholomew',
    )
    for (const maxW of [120, 160, 200, 240, INNER]) {
      const r = effectRows([reward, neutral('Limit: 3 days')], maxW, width, 9)
      wellFormed(r.rows)
      for (const row of r.rows)
        expect(width(row.text)).toBeLessThanOrEqual(maxW)
    }
  })

  it('a lone dash sticks to the word before it (a continuation row never starts with `—`)', () => {
    const r = effectRows(
      [
        cost('Truck 12 lost — your last vehicle'),
        cost('−1 life — this can end the run'),
      ],
      110,
      width,
      9,
    )
    for (const row of r.rows)
      expect(row.text.startsWith('—'), row.text).toBe(false)
    wellFormed(r.rows)
  })

  it('three rows needed → overflow; two rows kept, the second cut with `…` in the tone of the char it replaces', () => {
    const r = effectRows([cost(W30), gain(W30), cost(W30)], INNER, width)
    expect(r.overflow).toBe(true)
    expect(r.rows).toHaveLength(2)
    const last = r.rows[1]!
    expect(last.text.endsWith('…')).toBe(true)
    expect(width(last.text)).toBeLessThanOrEqual(INNER)
    expect(last.text.startsWith(W30)).toBe(true)
    // The run-on goes `xxx… · xxx`: the cut lands in the third (cost) segment.
    expect(toneAt(last, last.text.length - 1)).toBe('cost')
    expect(toneAt(last, 0)).toBe('gain')
    wellFormed(r.rows)
  })

  it('no lines → no rows', () => {
    expect(effectRows([], INNER, width)).toEqual({ rows: [], overflow: false })
  })
})

describe('D-M12-3 disabledRow: the greyed option shows the reason and the price', () => {
  it("`Can't afford · $150`, all disabled; the reason alone for a free option", () => {
    expect(disabledRow(data.puns.eventWords.cantAfford, 150)).toEqual({
      text: "Can't afford · $150",
      spans: [{ from: 0, len: 19, tone: 'disabled' }],
    })
    expect(disabledRow(null, 0).text).toBe(EVENT_CANT_AFFORD)
    expect(disabledRow(null, 1500).text).toBe("Can't afford · $1,500")
    expect(EVENT_CANT_AFFORD).toBe(data.puns.eventWords.cantAfford)
  })
})

describe('B3 §3.4 wrapFlow: beside the 48-px picture, then full width (critique 24)', () => {
  it('rows at tops 32/46/60/74 are 222 wide (x 66), the row at 88 is 276 (x 12)', () => {
    expect(eventColumn(74)).toEqual({ x: 66, w: 222 })
    expect(eventColumn(EVENT_INSET_BOTTOM)).toEqual({ x: 12, w: 276 })
    // 30-px words + 5-px spaces: 6 fit in 222, 8 in 276.
    const words = Array.from({ length: 6 * 4 + 8 }, () => 'xxxxx')
    const r = wrapFlow(words.join(' '), 32, 5, (t) => eventColumn(t), width)
    expect(r.overflow).toBe(false)
    expect(r.lines.map((l) => [l.x, l.y])).toEqual([
      [66, 32],
      [66, 46],
      [66, 60],
      [66, 74],
      [12, 88],
    ])
    expect(r.lines.map((l) => l.text.split(' ').length)).toEqual([
      6, 6, 6, 6, 8,
    ])
  })

  it('words left after maxLines → overflow and the last line cut with `…`', () => {
    const words = Array.from({ length: 6 * 4 + 9 }, () => 'xxxxx')
    const r = wrapFlow(words.join(' '), 32, 5, (t) => eventColumn(t), width)
    expect(r.overflow).toBe(true)
    expect(r.lines).toHaveLength(5)
    expect(r.lines[4]!.text.endsWith('…')).toBe(true)
    expect(width(r.lines[4]!.text)).toBeLessThanOrEqual(276)
  })

  it('a single word wider than its line → overflow (cut, never drawn past the edge); empty text → no lines', () => {
    const r = wrapFlow('y'.repeat(60), 32, 1, (t) => eventColumn(t), width)
    expect(r.overflow).toBe(true)
    expect(width(r.lines[0]!.text)).toBeLessThanOrEqual(222)
    expect(wrapFlow('  ', 32, 4, (t) => eventColumn(t), width)).toEqual({
      lines: [],
      overflow: false,
    })
  })
})

/** 0, 1 or 2 effects rows. */
const rows = (n: 0 | 1 | 2): EffectLine[] =>
  n === 0 ? [] : n === 1 ? ONE : TWO

describe('B3 §3.4 layoutEventCard: the heights of contract §1.4 (w 300)', () => {
  const cases: [string, Partial<EventCardInput>, number, boolean][] = [
    [
      'the gang head: title + 2 body, 2 options (1, 1)',
      { body: body(2), options: [opt(0, rows(1)), opt(1, rows(1))] },
      227,
      true,
    ],
    [
      'the scanner course: title + 1 body, 3 options (1, 1, 0)',
      {
        body: body(1),
        options: [opt(0, rows(1)), opt(1, rows(1)), opt(2, rows(0))],
      },
      277,
      true,
    ],
    [
      'news (the rain): title + 1 body, 1 option (1)',
      { kind: 'news', body: body(1), options: [opt(0, rows(1))] },
      161,
      true,
    ],
    [
      'title + 4 body, 3 options (1, 1, 1)',
      {
        body: body(4),
        options: [opt(0, rows(1)), opt(1, rows(1)), opt(2, rows(1))],
      },
      313,
      true,
    ],
    [
      'parent + title + 4 body, 3 options (2, 2, 0)',
      {
        parentChoice: 'You chose: Pay up',
        body: body(4),
        options: [opt(0, rows(2)), opt(1, rows(2)), opt(2, rows(0))],
      },
      339,
      true,
    ],
    [
      'title + 4 body, 3 options (2, 2, 2): the fit test fails this data',
      {
        body: body(4),
        options: [opt(0, rows(2)), opt(1, rows(2)), opt(2, rows(2))],
      },
      355,
      false,
    ],
  ]
  it.each(cases)('%s → h %i', (_name, extra, h, fits) => {
    const m = layoutEventCard(card(extra), width)
    expect(m.h).toBe(h)
    expect(m.fits).toBe(fits)
    expect(m.w).toBe(300)
    if (!fits)
      expect(eventCardMisfits(m)).toEqual([`h ${h} > ${EVENT_CARD_MAX_H}`])
    else expect(eventCardMisfits(m)).toEqual([])
  })

  it('the flow: the title gold at (66, 32), the body muted beside then full width; a parent line pushes the title down', () => {
    const m = layoutEventCard(card({ body: body(4) }), width)
    expect(m.flow.map((f) => [f.kind, f.x, f.y])).toEqual([
      ['title', 66, 32],
      ['body', 66, 46],
      ['body', 66, 60],
      ['body', 66, 74],
      ['body', 12, 88],
    ])
    expect(m.flow[0]!.tint).toBe(EVENT_TITLE_TINT)
    expect(m.flow[1]!.tint).toBe(EVENT_MUTED)
    expect(m.ruleY).toBe(106)
    const p = layoutEventCard(card({ parentChoice: 'You chose: Deny' }), width)
    expect(p.flow.map((f) => [f.kind, f.y])).toEqual([
      ['parent', 32],
      ['title', 46],
      ['body', 60],
      ['body', 74],
    ])
    expect(p.flow[0]!.tint).toBe(EVENT_MUTED)
  })

  it('the rule never rises above the picture inset: a short card rules at 86', () => {
    const m = layoutEventCard(card({ body: '' }), width)
    expect(m.ruleY).toBe(EVENT_INSET_BOTTOM + 4)
    expect(m.options[0]!.y).toBe(86 + 1 + 6)
  })

  it('a job card: the objective (dark) follows the body in the same column rule; y += 14 per line (critique 24)', () => {
    const m = layoutEventCard(
      card({
        kind: 'job',
        word: 'JOB BOARD',
        body: body(2),
        objective: 'Deliver 22 parcels sent from Pasture Peer Fields',
        options: [
          opt(0, ONE),
          opt(1, [neutral('Next job in 2 days')], { default: true }),
        ],
      }),
      width,
    )
    expect(m.mode).toBe('job')
    expect(m.masthead).toBe('JOB BOARD')
    // Title 32, body 46/60, the objective at 74 (beside the picture) and 88 (full width).
    const obj = m.flow.filter((f) => f.kind === 'objective')
    expect(obj.map((f) => [f.x, f.y, f.tint])).toEqual([
      [66, 74, EVENT_DARK],
      [12, 88, EVENT_DARK],
    ])
    expect(m.ruleY).toBe(88 + 14 + 4)
    expect(m.enter).toBe(0)
    expect(m.options.map((o) => o.face)).toEqual(['primary', 'secondary'])
  })

  it('every flow line, row and label fits its width', () => {
    const m = layoutEventCard(
      card({ parentChoice: 'You chose: Pay up', body: body(4) }),
      width,
    )
    for (const f of m.flow)
      expect(width(f.text)).toBeLessThanOrEqual(eventColumn(f.y).w)
  })
})

describe('B3 §3.4 faces, Enter and the option geometry', () => {
  it('first primary, a danger option red (index 0 too), the rest secondary', () => {
    const m = layoutEventCard(
      card({
        options: [opt(0, ONE), opt(1, ONE, { danger: true }), opt(2, [])],
      }),
      width,
    )
    expect(m.options.map((o) => o.face)).toEqual([
      'primary',
      'red',
      'secondary',
    ])
    expect(m.mode).toBe('three')
    const d = layoutEventCard(
      card({ options: [opt(0, ONE, { danger: true }), opt(1, ONE)] }),
      width,
    )
    expect(d.options.map((o) => o.face)).toEqual(['red', 'secondary'])
  })

  it('D-M12-2: Enter is the first option, never a danger or greyed one; the OK on news; Accept on a job', () => {
    expect(layoutEventCard(card(), width).enter).toBe(0)
    expect(
      layoutEventCard(
        card({ options: [opt(0, ONE, { danger: true }), opt(1, ONE)] }),
        width,
      ).enter,
    ).toBeNull()
    expect(
      layoutEventCard(
        card({
          options: [
            opt(0, ONE, {
              affordable: false,
              cost: 150,
              reason: "Can't afford",
            }),
            opt(1, ONE),
          ],
        }),
        width,
      ).enter,
    ).toBeNull()
    expect(
      layoutEventCard(card({ kind: 'news', options: [opt(0, ONE)] }), width)
        .enter,
    ).toBe(0)
    expect(
      layoutEventCard(
        card({ kind: 'job', options: [opt(0, ONE), opt(1, [])] }),
        width,
      ).enter,
    ).toBe(0)
  })

  it('critique 5: a decision card whose `if` hid the rest is still a decision (no tap-anywhere); the data index carries through', () => {
    const v = card({ options: [opt(2, ONE, { danger: true })] })
    expect(eventCardMode(v)).toBe('decision')
    const m = layoutEventCard(v, width)
    expect(m.mode).toBe('decision')
    expect(m.enter).toBeNull()
    expect(m.options[0]!.index).toBe(2)
    const hidden = layoutEventCard(
      card({ options: [opt(1, ONE), opt(2, ONE)] }),
      width,
    )
    expect(hidden.enter).toBe(1)
    expect(eventCardMode(card({ kind: 'news', options: [opt(0, ONE)] }))).toBe(
      'news',
    )
    expect(eventCardMode(card({ kind: 'job' }))).toBe('job')
  })

  it('a greyed option shows the reason row instead of its effects', () => {
    const m = layoutEventCard(
      card({
        options: [
          opt(0, TWO, { affordable: false, cost: 150, reason: "Can't afford" }),
          opt(1, ONE),
        ],
      }),
      width,
    )
    const o = m.options[0]!
    expect(o.enabled).toBe(false)
    expect(o.rows.map((r) => r.text)).toEqual(["Can't afford · $150"])
    expect(o.overflow).toBe(false)
  })

  it('option hits: the button plus its rows, inside the card and disjoint; rows start 2 px under the button', () => {
    const m = layoutEventCard(
      card({
        parentChoice: 'You chose: Pay up',
        body: body(4),
        options: [opt(0, TWO), opt(1, TWO), opt(2, [])],
      }),
      width,
    )
    for (const o of m.options) {
      expect(o.hit.x).toBe(12)
      expect(o.hit.w).toBe(INNER)
      expect(o.hit.y).toBe(o.y)
      expect(o.hit.h).toBe(44 + (o.rows.length ? 2 + 14 * o.rows.length : 0))
      expect(o.rowsY).toBe(o.y + 46)
      expect(o.hit.y + o.hit.h).toBeLessThanOrEqual(m.h)
    }
    for (let i = 1; i < m.options.length; i++) {
      const a = m.options[i - 1]!.hit
      expect(m.options[i]!.hit.y).toBeGreaterThanOrEqual(a.y + a.h)
    }
  })

  it('endsRun: a line ending `this can end the run` marks the option', () => {
    const lines = [cost('−1 life — this can end the run')]
    expect(endsRun(lines)).toBe(true)
    expect(endsRun(ONE)).toBe(false)
    const m = layoutEventCard(
      card({ options: [opt(0, ONE), opt(1, lines, { danger: true })] }),
      width,
    )
    expect(m.options.map((o) => o.endsRun)).toEqual([false, true])
  })

  it('a label wider than the face (labels never wrap) is an overflow, named by eventCardMisfits', () => {
    const long = 'W'.repeat(60)
    expect(width(long)).toBeGreaterThan(INNER - 2 * EVENT_LABEL_PAD)
    const m = layoutEventCard(
      card({ options: [opt(0, ONE, { label: long }), opt(1, ONE)] }),
      width,
    )
    expect(m.options[0]!.labelOverflow).toBe(true)
    expect(m.fits).toBe(false)
    expect(eventCardMisfits(m)).toEqual(['option 0 label'])
  })
})

describe('B3 §3.4 eventCardRect: 8 px above the bottom bar, never above the ticker', () => {
  it.each([
    [360, 604, 30],
    [393, 659, 47],
    [430, 932, 65],
  ] as const)('%i × %i → x %i', (W, H, x) => {
    const L = computeLayout(W, H, 0, 0, 1)
    for (const h of [161, 227, 313, 339, 340]) {
      const r = eventCardRect(L, h)
      expect(r.x).toBe(x)
      expect(r.w).toBe(300)
      expect(r.h).toBe(h)
      expect(r.y).toBeGreaterThanOrEqual(L.ticker.y + L.ticker.h)
      expect(r.y + r.h).toBe(L.bottomBar.y - 8)
    }
  })

  it('a 360 × 604 card 340 tall sits at 192 (bar 540)', () => {
    const L = computeLayout(360, 604, 0, 0, 1)
    expect(L.bottomBar.y).toBe(540)
    expect(eventCardRect(L, 340).y).toBe(192)
  })
})

describe('the shared helpers', () => {
  it('eventChoiceLine: `The recall — you chose: Take the strike`', () => {
    expect(eventChoiceLine(data, 'The recall', 'Take the strike')).toBe(
      'The recall — you chose: Take the strike',
    )
    expect(lowerFirst('You')).toBe('you')
    expect(lowerFirst('')).toBe('')
  })

  it('modifierIcon covers every modifier key with a world frame', () => {
    for (const k of MODIFIER_KEYS) {
      const f = modifierIcon(k)
      expect(f, k).toMatch(/^ic_/)
      expect(inAtlas(f, 'world'), `${k} → ${f}`).toBe(true)
    }
  })

  it('timeLeftText: permanent / `1d 0h left`', () => {
    expect(timeLeftText(null)).toBe('permanent')
    expect(timeLeftText(600)).toBe('1d 0h left')
  })

  it('the tone tints sit on the light panel (red, green, muted, grey)', () => {
    expect(new Set(Object.values(EFFECT_TONE_TINT)).size).toBe(4)
  })
})

describe('m5x7: every constant string the card draws is in the font', () => {
  it("PAUSED, the separator, `Can't afford`, `Tap an option`, `…`, `−`, `★`, `—`", () => {
    for (const s of [
      EVENT_PAUSED_TEXT,
      EVENT_SEP,
      EVENT_CANT_AFFORD,
      EVENT_ENTER_DENY,
      disabledRow(null, 1500).text,
      '…−★—·',
      'Day 99',
    ])
      expect(missing(s), s).toEqual([])
  })
})
