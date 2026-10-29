// city-view.md §4.2 toast lane + UX M2: the HUD re-lays the toast lane on
// every city ↔ warehouse switch (the warehouse lane sits on the room's north
// wall). A relayout during a toast's 150-ms fade-out stopped the fade, whose
// onComplete never ran: the lane kept a half-faded toast and every later
// toast only queued. The relayout now finishes the fade. A chainable fake
// scene stands in for Phaser (Toast.ts only type-imports it).
import { describe, expect, it } from 'vitest'
import { Toast } from '../../src/ui/Toast.ts'

interface Fake {
  x: number
  y: number
  alpha: number
  visible: boolean
  width: number
  [k: string]: unknown
}

function fakeObj(): Fake {
  const o: Fake = { x: 0, y: 0, alpha: 1, visible: true, width: 40 }
  const proxy: Fake = new Proxy(o, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'setX') return (v: number) => ((t.x = v), proxy)
      if (k === 'setY') return (v: number) => ((t.y = v), proxy)
      if (k === 'setAlpha') return (v: number) => ((t.alpha = v), proxy)
      if (k === 'setVisible') return (v: boolean) => ((t.visible = v), proxy)
      if (k === 'getTextBounds') return () => ({ lines: { lengths: [1] } })
      return () => proxy
    },
  })
  return proxy
}

function fakeScene() {
  const timers: { fn: () => void; dead: boolean }[] = []
  const tweens: {
    cfg: Record<string, unknown> & { onComplete?: () => void }
    stopped: boolean
  }[] = []
  const scene = {
    scale: { width: 393 },
    add: {
      nineslice: () => fakeObj(),
      bitmapText: () => fakeObj(),
      container: () => fakeObj(),
    },
    tweens: {
      add(cfg: Record<string, unknown> & { onComplete?: () => void }) {
        const t = { cfg, stopped: false }
        tweens.push(t)
        return {
          stop() {
            t.stopped = true
          },
        }
      },
    },
    time: {
      delayedCall(_ms: number, fn: () => void) {
        const t = { fn, dead: false }
        timers.push(t)
        return {
          remove() {
            t.dead = true
          },
        }
      },
    },
    events: { once() {}, off() {} },
    game: { events: { on() {}, off() {} } },
  }
  return { scene, timers, tweens }
}

describe('§4.2 toast lane survives a relayout mid-fade', () => {
  it('a relayout during the fade-out finishes it, and the next toast shows', () => {
    const { scene, timers, tweens } = fakeScene()
    const lane = { x: 12, y: 68, w: 369, h: 24 }
    const toast = new Toast(scene as never, { lane })
    toast.show('first')
    expect(toast.currentText()).toBe('first')
    // the display timer fires → the fade-out tween starts
    timers.at(-1)!.fn()
    const fade = tweens.at(-1)!
    expect(fade.cfg['alpha']).toBe(0)
    // the HUD switches view mid-fade
    toast.relayout({ W: 393, toast: { ...lane, y: 123 } })
    expect(fade.stopped).toBe(true)
    expect(toast.currentText()).toBeNull()
    toast.show('second')
    expect(toast.currentText()).toBe('second')
    const root = toast.root as unknown as Fake
    expect(root.visible).toBe(true)
    expect(root.alpha).toBe(1)
  })

  it('a relayout while showing keeps the toast and moves it to the new lane', () => {
    const { scene } = fakeScene()
    const lane = { x: 12, y: 68, w: 369, h: 24 }
    const toast = new Toast(scene as never, { lane })
    toast.show('hello')
    toast.relayout({ W: 393, toast: { ...lane, y: 123 } })
    expect(toast.currentText()).toBe('hello')
    expect((toast.root as unknown as Fake).y).toBe(123)
  })
})
