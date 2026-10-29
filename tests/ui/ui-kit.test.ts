// city-view.md §4.1 (money `$1,234`, no decimals), §7.1 (`Payday in 0:23`),
// §4.2 (toast lane: 2.5 s / 4 s red, queue of at most 3, older ones drop),
// §10 (Esc closes only the top-most sheet/dialog), style-guide.md §1.7 (bars:
// 3-px caps) and the m5x7 cap-centring rule (cap top 4, cap height 7, pitch 14).
import { describe, expect, it } from 'vitest'
import { barFillWidth, BAR_CAP } from '../../src/ui/Panel.ts'
import {
  claimKey,
  keyClaimed,
  modalCount,
  popModal,
  pushModal,
  topModal,
} from '../../src/ui/Sheet.ts'
import {
  ToastQueue,
  TOAST_MS,
  TOAST_QUEUE_MAX,
  TOAST_RED_MS,
  toastDuration,
} from '../../src/ui/Toast.ts'
import {
  ellipsize,
  formatClock,
  formatInt,
  formatMoney,
  formatMoneyDelta,
  formatPct,
  MINUS,
  textTop,
} from '../../src/ui/text.ts'

describe('number formats (§4.1 money has thousands separators, no decimals)', () => {
  it('formats money', () => {
    expect(formatMoney(0)).toBe('$0')
    expect(formatMoney(1234)).toBe('$1,234')
    expect(formatMoney(1240.6)).toBe('$1,241')
    expect(formatMoney(1234567)).toBe('$1,234,567')
    expect(formatMoney(-28)).toBe(`${MINUS}$28`)
    expect(formatMoney(Number.NaN)).toBe('$0')
  })
  it('formats ints, deltas and percents', () => {
    expect(formatInt(999)).toBe('999')
    expect(formatInt(1000)).toBe('1,000')
    expect(formatInt(-5000)).toBe(`${MINUS}5,000`)
    expect(formatMoneyDelta(12)).toBe('+$12')
    expect(formatMoneyDelta(-28)).toBe(`${MINUS}$28`)
    expect(formatMoneyDelta(0)).toBe('$0')
    expect(formatPct(96.6)).toBe('97%')
  })
})

describe('countdown clock (§7.1 Payday in 0:23)', () => {
  it('is m:ss with partial seconds rounded up', () => {
    expect(formatClock(23)).toBe('0:23')
    expect(formatClock(22.1)).toBe('0:23')
    expect(formatClock(60)).toBe('1:00')
    expect(formatClock(605)).toBe('10:05')
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(-3)).toBe('0:00')
  })
})

const measure = (s: string): number => s.length * 6

describe('m5x7 cap centring', () => {
  it('centres the 7-px cap band of one line in a box', () => {
    // 24-px row: caps at rows 8..14 → glyph top at 8 − 4 = 4.
    expect(textTop(0, 24)).toBe(4)
    expect(textTop(100, 44)).toBe(100 + 18 - 4)
    // 14-px badge: caps 3..9 → glyph top −1.
    expect(textTop(0, 14)).toBe(-1)
  })
  it('centres multi-line ink (pitch 14)', () => {
    expect(textTop(0, 38, 2)).toBe(Math.floor((38 - 21) / 2) - 4)
  })
  it('ellipsizes to a width', () => {
    expect(ellipsize('Hoist Hill', 60, measure)).toBe('Hoist Hill')
    const out = ellipsize('Semver Street Depot', 60, measure)
    expect(out.endsWith('…')).toBe(true)
    expect(measure(out)).toBeLessThanOrEqual(60)
  })
})

describe('bar fill width (3-slice caps)', () => {
  it('hides at 0, keeps both caps, never exceeds the track', () => {
    expect(barFillWidth(100, 0)).toBe(0)
    expect(barFillWidth(100, -1)).toBe(0)
    expect(barFillWidth(100, 0.01)).toBe(2 * BAR_CAP)
    expect(barFillWidth(100, 0.5)).toBe(50)
    expect(barFillWidth(100, 2)).toBe(100)
    expect(barFillWidth(100, Number.NaN)).toBe(0)
  })
})

describe('toast queue (§4.2 one visible, at most 3 waiting, older drop)', () => {
  it('shows the first, queues the rest and drops the oldest waiting', () => {
    const q = new ToastQueue()
    expect(q.push({ text: 'a', red: false })).toBe('show')
    for (const t of ['b', 'c', 'd', 'e'])
      expect(q.push({ text: t, red: false })).toBe('queued')
    expect(q.waiting.map((w) => w.text)).toEqual(['c', 'd', 'e'])
    expect(q.waiting.length).toBe(TOAST_QUEUE_MAX)
    expect(q.next()?.text).toBe('c')
    expect(q.next()?.text).toBe('d')
    expect(q.next()?.text).toBe('e')
    expect(q.next()).toBeNull()
    expect(q.push({ text: 'f', red: true })).toBe('show')
  })
  it('restarts a duplicate of the visible toast and dedupes waiting ones', () => {
    const q = new ToastQueue()
    q.push({ text: 'Lives', red: false })
    expect(q.push({ text: 'Lives', red: false })).toBe('restart')
    q.push({ text: 'x', red: false })
    q.push({ text: 'x', red: false })
    expect(q.waiting.length).toBe(1)
  })
  it('lasts 2.5 s, or 4 s when red', () => {
    expect(toastDuration(false)).toBe(TOAST_MS)
    expect(TOAST_MS).toBe(2500)
    expect(toastDuration(true)).toBe(TOAST_RED_MS)
    expect(TOAST_RED_MS).toBe(4000)
  })
})

describe('modal stack (§10 Esc closes the top-most sheet/panel only)', () => {
  it('gives a key event to the top modal once', () => {
    const sheet = {}
    const dialog = {}
    const base = modalCount()
    pushModal(sheet)
    pushModal(dialog)
    expect(topModal()).toBe(dialog)
    const ev = { key: 'Escape' } as KeyboardEvent
    // The sheet's listener may run first: not on top, so it declines.
    expect(claimKey(ev, sheet)).toBe(false)
    expect(claimKey(ev, dialog)).toBe(true)
    popModal(dialog)
    // Same event, now the sheet is on top: already claimed.
    expect(keyClaimed(ev)).toBe(true)
    expect(claimKey(ev, sheet)).toBe(false)
    const ev2 = { key: 'Escape' } as KeyboardEvent
    expect(claimKey(ev2, sheet)).toBe(true)
    popModal(sheet)
    expect(modalCount()).toBe(base)
    // With no modal open, a null owner (HUD shortcuts) may claim.
    expect(claimKey({ key: 'g' } as KeyboardEvent, null)).toBe(true)
  })
})
