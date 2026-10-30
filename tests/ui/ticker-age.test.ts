// report-playtest1 §6.6 / plan-build2 §8.2 task 10: the ticker trailed the
// clock (`Day 5: …` still scrolling at 13:16, the 20:00 summary offer lost
// behind 8 queued lines). The queue now drops a waiting `Day N:` line when a
// newer one queues, drops any waiting line older than 90 s on the ticker's
// own (unpaused) clock, and lets the 8-line cap evict fillers, then day
// lines, then the rest — the summary offer, a lost life and a level-up last.
import { describe, expect, it } from 'vitest'
import {
  dailyLine,
  evictRank,
  TICKER_IMPORTANT,
  TICKER_MAX_AGE_MS,
  TICKER_QUEUE_MAX,
  TickerQueue,
  type TickerLineKind,
} from '../../src/ui/Ticker.ts'

const S = 1000
const day = (n: number): string => dailyLine(n, 10 + n, 100 * n, 0)
const texts = (q: TickerQueue): string[] => q.waiting.map((w) => w.text)

describe('report §6.6: the age rule (90 s on the ticker clock)', () => {
  it('is a 90-s UI pacing constant', () => {
    expect(TICKER_MAX_AGE_MS).toBe(90_000)
  })

  it('drops a waiting line older than 90 s when the next line is promoted', () => {
    const q = new TickerQueue()
    q.push({ text: 'Warehouse backed up — shelf full', kind: 'stall' }, 0)
    q.push({ text: 'New strain spotted: rattle', kind: 'strain' }, 30 * S)
    // 95 s later the first is stale, the second (65 s old) still runs.
    expect(q.next(95 * S)?.text).toBe('New strain spotted: rattle')
    expect(q.waiting).toEqual([])
  })

  it('keeps a line queued exactly 90 s ago (the rule is "older than")', () => {
    const q = new TickerQueue()
    q.push({ text: 'a', kind: 'mood' }, 10 * S)
    expect(q.next(100 * S)?.text).toBe('a')
  })

  it('applies to every kind, the important ones included', () => {
    const q = new TickerQueue()
    for (const kind of [...TICKER_IMPORTANT, 'daily', 'filler'] as const)
      q.push({ text: `old ${kind}`, kind }, 0)
    q.push({ text: 'fresh', kind: 'region' }, 60 * S)
    expect(q.next(91 * S)?.text).toBe('fresh')
    expect(q.next(91 * S)).toBeNull()
  })

  it('prunes on push too, so a stale line never makes the cap evict a fresh one', () => {
    const q = new TickerQueue()
    for (let i = 0; i < TICKER_QUEUE_MAX; i++)
      q.push({ text: `old ${i}`, kind: 'stall' }, 0)
    q.push({ text: 'Lv 2: Hoist Hill', kind: 'level' }, 100 * S)
    expect(texts(q)).toEqual(['Lv 2: Hoist Hill'])
  })

  it('a stale duplicate no longer blocks the same text', () => {
    const q = new TickerQueue()
    expect(q.push({ text: 'Close call!', kind: 'defused' }, 0)).toBe('queued')
    expect(q.push({ text: 'Close call!', kind: 'defused' }, 10 * S)).toBe(
      'duplicate',
    )
    expect(q.push({ text: 'Close call!', kind: 'defused' }, 91 * S)).toBe(
      'queued',
    )
    expect(q.waiting).toEqual([
      { text: 'Close call!', kind: 'defused', at: 91 * S },
    ])
  })

  it('a line that is already scrolling is never dropped by age', () => {
    const q = new TickerQueue()
    q.push({ text: 'a', kind: 'mood' }, 0)
    expect(q.next(0)?.text).toBe('a')
    q.prune(500 * S)
    expect(q.current?.text).toBe('a')
  })
})

describe('report §6.6: a newer day line replaces the stale ones', () => {
  it('drops the waiting `Day N:` lines when `Day N+1:` queues, keeping the others in order', () => {
    const q = new TickerQueue()
    q.push({ text: day(4), kind: 'daily' }, 0)
    q.push({ text: 'Close call! log4j defused', kind: 'defused' }, 1 * S)
    q.push({ text: day(5), kind: 'daily' }, 2 * S)
    expect(texts(q)).toEqual(['Close call! log4j defused', day(5)])
    q.push({ text: day(6), kind: 'daily' }, 3 * S)
    expect(texts(q)).toEqual(['Close call! log4j defused', day(6)])
  })

  it('never cuts the day line already scrolling', () => {
    const q = new TickerQueue()
    q.push({ text: day(4), kind: 'daily' }, 0)
    q.next(0)
    q.push({ text: day(5), kind: 'daily' }, 1 * S)
    expect(q.current?.text).toBe(day(4))
    expect(texts(q)).toEqual([day(5)])
  })

  it('the summary offer is its own kind, not a day line', () => {
    const q = new TickerQueue()
    q.push({ text: '20 minutes in: Pause ▸ End run', kind: 'offer' }, 0)
    q.push({ text: day(20), kind: 'daily' }, 1 * S)
    expect(texts(q)).toEqual(['20 minutes in: Pause ▸ End run', day(20)])
  })
})

describe('report §6.6: the 8-line cap evicts by importance', () => {
  it('ranks filler < daily < the rest < offer / lost life / level-up', () => {
    const kinds: TickerLineKind[] = [
      'filler',
      'daily',
      'stall',
      'strain',
      'offer',
      'incident',
      'level',
    ]
    expect(kinds.map(evictRank)).toEqual([0, 1, 2, 2, 3, 3, 3])
    expect([...TICKER_IMPORTANT].toSorted()).toEqual([
      'incident',
      'level',
      'offer',
    ])
  })

  it('drops the stale day line before any important line', () => {
    const q = new TickerQueue()
    q.push({ text: day(12), kind: 'daily' }, 0)
    q.push({ text: 'Lv 2: Hoist Hill + trucks', kind: 'level' }, 1 * S)
    q.push({ text: 'Malware delivered to Async Arms', kind: 'incident' }, 2 * S)
    for (let i = 0; i < 5; i++)
      q.push({ text: `Lv 2 incident ${i}`, kind: 'incident' }, 3 * S)
    expect(q.waiting.length).toBe(TICKER_QUEUE_MAX)
    q.push({ text: '20 minutes in', kind: 'offer' }, 4 * S)
    expect(q.waiting.length).toBe(TICKER_QUEUE_MAX)
    expect(texts(q)).not.toContain(day(12))
    expect(texts(q)).toContain('20 minutes in')
    expect(texts(q)).toContain('Lv 2: Hoist Hill + trucks')
  })

  it('drops fillers first, then day lines, then ordinary lines (oldest of the rank)', () => {
    const q = new TickerQueue()
    q.push({ text: 'stall 1', kind: 'stall' }, 0)
    q.push({ text: 'filler', kind: 'filler' }, 0)
    q.push({ text: day(3), kind: 'daily' }, 0)
    for (let i = 2; i <= 6; i++)
      q.push({ text: `stall ${i}`, kind: 'stall' }, 0)
    expect(q.waiting.length).toBe(8)
    q.push({ text: 'offer', kind: 'offer' }, 0)
    expect(texts(q)).not.toContain('filler')
    q.push({ text: 'level', kind: 'level' }, 0)
    expect(texts(q)).not.toContain(day(3))
    q.push({ text: 'incident', kind: 'incident' }, 0)
    expect(texts(q)).not.toContain('stall 1')
    expect(texts(q)).toEqual([
      'stall 2',
      'stall 3',
      'stall 4',
      'stall 5',
      'stall 6',
      'offer',
      'level',
      'incident',
    ])
  })

  it('evicts the oldest important line only when every waiting line is important', () => {
    const q = new TickerQueue()
    for (let i = 0; i < 9; i++) q.push({ text: `level ${i}`, kind: 'level' }, i)
    expect(texts(q)[0]).toBe('level 1')
    expect(q.waiting.length).toBe(8)
  })
})
