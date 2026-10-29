// city-view.md §4.2: one toast visible, at most 3 waiting, older ones drop.
// The red variant carries payroll short / wrong toss / walkout (§9.7), and a
// payday tick can queue a plain burst behind it (payday line, mood lines,
// `Now playing`, a region toast). Dropping strictly by age pushed the red
// toasts out first (an iPhone-profile run queued 8 toasts and never showed
// `Payroll short` or the walkout). Overflow now drops the oldest plain toast,
// and a red one only when every waiting toast is red.
import { describe, expect, it } from 'vitest'
import { TOAST_QUEUE_MAX, ToastQueue } from '../../src/ui/Toast.ts'

const plain = (text: string) => ({ text, red: false })
const red = (text: string) => ({ text, red: true })

describe('toast queue overflow keeps the red toasts', () => {
  it('drops the oldest plain toast before any red one', () => {
    const q = new ToastQueue()
    q.push(plain('Payday — payroll −$28'))
    q.push(red('Payroll short: Audrey unpaid'))
    q.push(red('Audrey walked out — Bike 1 has no driver'))
    q.push(plain('Now playing: Semver Swing'))
    q.push(plain('Hoist Hill is now open'))
    q.push(plain('New strain spotted: rattle'))
    expect(q.waiting.length).toBe(TOAST_QUEUE_MAX)
    expect(q.waiting.map((w) => w.text)).toEqual([
      'Payroll short: Audrey unpaid',
      'Audrey walked out — Bike 1 has no driver',
      'New strain spotted: rattle',
    ])
  })

  it('drops a new plain toast when every waiting one is red', () => {
    const q = new ToastQueue()
    q.push(plain('Payday — payroll −$28'))
    for (const t of ['a', 'b', 'c']) q.push(red(t))
    q.push(plain('Lifetime earned $192 · Payroll $28/day'))
    expect(q.waiting.map((w) => w.text)).toEqual(['a', 'b', 'c'])
  })

  it('drops the oldest red when only red toasts compete', () => {
    const q = new ToastQueue()
    q.push(plain('Payday — payroll −$28'))
    for (const t of ['a', 'b', 'c', 'd']) q.push(red(t))
    expect(q.waiting.map((w) => w.text)).toEqual(['b', 'c', 'd'])
  })

  it('keeps the plain order rule (older plain ones drop)', () => {
    const q = new ToastQueue()
    q.push(plain('first'))
    for (const t of ['b', 'c', 'd', 'e']) q.push(plain(t))
    expect(q.waiting.map((w) => w.text)).toEqual(['c', 'd', 'e'])
  })
})
