// Decision #4 / city-view.md §9.5: the rotate card covers the whole canvas
// and swallows every tap while a phone is in landscape. The lost-life,
// game-over and summary cards and every Dialog draw through their own
// cameras added after the HUD's, and the Garage is a scene above the HUD, so
// in landscape they drew over the card (iPhone 16 profile, 852×393). While
// open the card now draws through its own camera, kept last at every
// prerender and blind to every other object (also ones added later), and
// lifts its scene over the scenes above it; closing removes the camera,
// clears its ignore bits and puts those scenes back on top in order.
// RotateCard type-imports Phaser only: a fake scene stands in.
import { describe, expect, it } from 'vitest'
import { clearCameraBit, removeCamera } from '../../src/ui/cameraBits.ts'
import { keepCameraLast, RotateCard } from '../../src/ui/RotateCard.ts'
import {
  claimKey,
  keyClaimed,
  keysBlocked,
  popModal,
  pushModal,
} from '../../src/ui/Sheet.ts'

type Bag = Record<string | symbol, unknown>

function chain<T extends object>(target: T): T {
  const base = target as Bag
  for (const [k, v] of Object.entries({
    x: 0,
    y: 0,
    width: 40,
    height: 14,
    visible: true,
    cameraFilter: 0,
  }))
    if (!(k in base)) base[k] = v
  const proxy: T = new Proxy(target, {
    get(t, k, receiver) {
      if (k in t) return Reflect.get(t, k, receiver)
      if (k === 'getTextBounds') return () => ({ lines: { lengths: [1] } })
      if (typeof k === 'symbol') return undefined
      return () => proxy
    },
  })
  return proxy
}

interface Obj {
  cameraFilter: number
  visible: boolean
}

function obj(): Obj {
  const o: Obj & Bag = { cameraFilter: 0, visible: true }
  o['setVisible'] = (v: boolean) => {
    o.visible = v
    return proxy
  }
  const proxy = chain(o)
  return proxy
}

class Cam {
  readonly id: number
  constructor(id: number) {
    this.id = id
  }
  ignore(o: Obj): this {
    o.cameraFilter |= this.id
    return this
  }
  setSize(): this {
    return this
  }
}

function emitter() {
  const ls = new Map<string, { fn: (a?: unknown) => void; ctx: unknown }[]>()
  return {
    on(n: string, fn: (a?: unknown) => void, ctx?: unknown) {
      ls.set(n, [...(ls.get(n) ?? []), { fn, ctx }])
    },
    once(n: string, fn: (a?: unknown) => void, ctx?: unknown) {
      ls.set(n, [...(ls.get(n) ?? []), { fn, ctx }])
    },
    off(n: string, fn: (a?: unknown) => void, ctx?: unknown) {
      ls.set(
        n,
        (ls.get(n) ?? []).filter((l) => !(l.fn === fn && l.ctx === ctx)),
      )
    },
    emit(n: string, a?: unknown) {
      for (const l of (ls.get(n) ?? []).slice()) l.fn.call(l.ctx, a)
    },
    count: (n: string) => (ls.get(n) ?? []).length,
  }
}

interface FakeSys {
  sys: {
    settings: { key: string }
    isActive(): boolean
    isVisible(): boolean
  }
}

function sceneSys(key: string, active: boolean): FakeSys {
  return {
    sys: {
      settings: { key },
      isActive: () => active,
      isVisible: () => active,
    },
  }
}

function fakeHud(aboveActive: boolean) {
  const order: string[] = []
  const city = sceneSys('City', true)
  const garage = sceneSys('Garage', aboveActive)
  const list: unknown[] = []
  const main = new Cam(1)
  const scene = {
    sys: sceneSys('HUD', true).sys,
    events: emitter(),
    add: {
      nineslice: () => {
        const o = obj()
        list.push(o)
        return o
      },
      image: () => {
        const o = obj()
        list.push(o)
        return o
      },
      bitmapText: () => {
        const o = obj()
        list.push(o)
        return o
      },
      container: () => {
        const o = obj()
        list.push(o)
        return o
      },
    },
    children: { list },
    cameras: {
      cameras: [main] as Cam[],
      // Phaser 4 CameraManager.getNextID: the lowest bit no live camera
      // holds — a removed camera's id goes to the next camera added.
      add() {
        let id = 1
        while (this.cameras.some((c) => c.id === id)) id <<= 1
        const c = new Cam(id)
        this.cameras.push(c)
        return c
      },
      remove(c: Cam) {
        const i = this.cameras.indexOf(c)
        if (i >= 0) this.cameras.splice(i, 1)
      },
    },
    scene: {
      manager: { scenes: [] as unknown[] },
      bringToTop(key?: string) {
        order.push(key ?? 'HUD')
      },
      get(key: string) {
        return key === 'Garage' ? garage : null
      },
    },
  }
  scene.scene.manager.scenes = [city, scene, garage]
  return { scene, main, list, order }
}

describe('the rotate card covers every camera and scene while open', () => {
  it('draws through its own camera that stays last and ignores everything else', () => {
    const { scene, main, list } = fakeHud(false)
    const before = list.length
    const card = new RotateCard(scene as never, 430, 393)
    const hudObj = list[0] as Obj
    expect(list.length).toBeGreaterThan(before)
    card.setOpen(true)
    expect(card.isOpen()).toBe(true)
    const cams = scene.cameras.cameras
    expect(cams.length).toBe(2)
    const rot = cams[1]!
    // The root is ignored by the main camera; the rest by the card's camera.
    expect(card.root.cameraFilter & main.id).toBe(main.id)
    expect(card.root.cameraFilter & rot.id).toBe(0)
    expect(hudObj.cameraFilter & rot.id).toBe(rot.id)

    // A card opens later with its own camera: the next prerender restores order.
    const late = obj()
    scene.events.emit('addedtoscene', late)
    expect(late.cameraFilter & rot.id).toBe(rot.id)
    const cardCam = scene.cameras.add()
    expect(scene.cameras.cameras.at(-1)).toBe(cardCam)
    scene.events.emit('prerender')
    expect(scene.cameras.cameras.at(-1)).toBe(rot)

    card.setOpen(false)
    expect(scene.cameras.cameras).not.toContain(rot)
    expect(hudObj.cameraFilter & rot.id).toBe(0)
    expect(late.cameraFilter & rot.id).toBe(0)
    expect(scene.events.count('prerender')).toBe(0)
    expect(scene.events.count('addedtoscene')).toBe(0)
  })

  it('lifts its scene over the Garage and puts the Garage back on top', () => {
    const { scene, order } = fakeHud(true)
    const card = new RotateCard(scene as never, 430, 393)
    card.setOpen(true)
    expect(order).toEqual(['HUD'])
    card.setOpen(true) // idempotent
    expect(order).toEqual(['HUD'])
    card.setOpen(false)
    expect(order).toEqual(['HUD', 'Garage'])
  })

  it('leaves the scene order alone when nothing is above', () => {
    const { scene, order } = fakeHud(false)
    const card = new RotateCard(scene as never, 430, 393)
    card.setOpen(true)
    card.setOpen(false)
    expect(order).toEqual([])
  })

  it('cleans up on scene shutdown while open', () => {
    const { scene } = fakeHud(true)
    const card = new RotateCard(scene as never, 430, 393)
    card.setOpen(true)
    scene.events.emit('shutdown')
    expect(scene.cameras.cameras.length).toBe(1)
    expect(scene.events.count('prerender')).toBe(0)
  })
})

describe('a removed card camera leaves no ignore bits behind (Phaser reuses its id)', () => {
  /** A card or dialog: its own camera ignoring everything else, then closed. */
  function cardRoundTrip(
    scene: ReturnType<typeof fakeHud>['scene'],
    list: unknown[],
    clean: boolean,
  ): number {
    const cam = scene.cameras.add()
    for (const o of list) cam.ignore(o as Obj)
    if (clean) removeCamera(scene as never, cam as never)
    else scene.cameras.remove(cam)
    return cam.id
  }

  it('after a confirm dialog the rotate card still draws through its camera (same id): removeCamera cleared the bit', () => {
    const { scene, list } = fakeHud(false)
    const card = new RotateCard(scene as never, 430, 393)
    const hudObj = list[0] as Obj
    const dialogId = cardRoundTrip(scene, list, true)
    expect(card.root.cameraFilter & dialogId).toBe(0)
    expect(hudObj.cameraFilter & dialogId).toBe(0)
    card.setOpen(true)
    const rot = scene.cameras.cameras.at(-1)!
    expect(rot.id).toBe(dialogId) // the freed id, reused
    expect(card.root.cameraFilter & rot.id).toBe(0)
    expect(hudObj.cameraFilter & rot.id).toBe(rot.id)
    card.setOpen(false)
  })

  it('raise clears a stale bit on its root even when a camera was removed without the helper', () => {
    const { scene, list } = fakeHud(false)
    const card = new RotateCard(scene as never, 430, 393)
    const staleId = cardRoundTrip(scene, list, false)
    expect(card.root.cameraFilter & staleId).toBe(staleId)
    card.setOpen(true)
    const rot = scene.cameras.cameras.at(-1)!
    expect(rot.id).toBe(staleId)
    expect(card.root.cameraFilter & rot.id).toBe(0)
    card.setOpen(false)
  })

  it("clearCameraBit walks containers and keeps other cameras' bits", () => {
    const child = { cameraFilter: 0b110 }
    const box = { cameraFilter: 0b101, list: [child, { list: [] }] }
    const plain = { cameraFilter: 0b100 }
    clearCameraBit([box, plain, null, 7], 0b100)
    expect(box.cameraFilter).toBe(0b001)
    expect(child.cameraFilter).toBe(0b010)
    expect(plain.cameraFilter).toBe(0)
  })
})

describe('the rotate card holds the keyboard while up (final review, scenes #3)', () => {
  const key = (k: string) => ({ key: k, repeat: false }) as KeyboardEvent

  it('no listener claims G / W / Space / Esc under it; closing (or a shutdown) hands the keys back', () => {
    const { scene } = fakeHud(false)
    const card = new RotateCard(scene as never, 430, 393)
    expect(keysBlocked()).toBe(false)
    card.setOpen(true)
    expect(keysBlocked()).toBe(true)
    const g = key('g')
    expect(claimKey(g, null)).toBe(false) // the HUD's G / W / Space
    expect(keyClaimed(g)).toBe(true) // every later listener skips it
    const sheet = {}
    pushModal(sheet)
    expect(claimKey(key('Escape'), sheet)).toBe(false) // a card's Esc
    popModal(sheet)
    card.setOpen(false)
    expect(keysBlocked()).toBe(false)
    const w = key('w')
    expect(keyClaimed(w)).toBe(false)
    expect(claimKey(w, null)).toBe(true)

    card.setOpen(true)
    scene.events.emit('shutdown')
    expect(keysBlocked()).toBe(false)
  })
})

describe('keepCameraLast', () => {
  it('moves a camera to the end only when it is not already last', () => {
    const a = { n: 'a' }
    const b = { n: 'b' }
    const c = { n: 'c' }
    const list = [a, b, c]
    expect(keepCameraLast(list, c)).toBe(false)
    expect(keepCameraLast(list, a)).toBe(true)
    expect(list).toEqual([b, c, a])
    expect(keepCameraLast(list, { n: 'x' })).toBe(false)
  })
})
