// Warehouse helpers shared by smoke.spec.ts and shots.spec.ts (plan.md
// §6.9.3, warehouse-view.md §1.1 / §7.5). Room geometry comes from the
// pure layout module (src/render/warehouse/RoomLayout.ts), so the specs tap
// the same rects the scene hit-tests; scene / HUD internals are read through
// casts like the M1 specs do. M8 (design-m8-m9 §6.1): `dockHit(k)` — dock
// k's door + pad tap rect from RoomLayout's dockGeom. M6 (design-m6 §6.1-§6.2): the Hold Bay station
// (HOLD_STATION_HIT, the sorter's SORTER_STAND, the rack lamp's S badge),
// the StationCard and the HireSheet (Warehouse id `wh:hire`, Garage id
// `garage:hire`; its cards are `<id>:card:<i>`) join openSheet / hireSheet.
import type { Page } from '@playwright/test'
import {
  bayRect,
  dockGeom,
  FixedLaneLayout,
  HOLD_STATION_HIT,
  ROOM_H,
  ROOM_W,
  SORTER_STAND,
  type Rect,
} from '../src/render/warehouse/RoomLayout.ts'
import { expect, type PmHelpers } from './fixtures.ts'

/** The tier-1 room (tiers 1-3 share every rect the specs tap, M8). */
export const roomLayout = new FixedLaneLayout()
export { bayRect, dockGeom, HOLD_STATION_HIT, ROOM_H, ROOM_W, SORTER_STAND }

/**
 * M8: dock k's tap rect (door + pad, 56 × 56; dock 1 is the layout's
 * `dock1` node rect), room px.
 */
export function dockHit(index: number): Rect {
  const g = dockGeom(index)
  if (!g) throw new Error(`no dock ${index}`)
  return g.hit
}

/** Where the room sits on screen and the HUD bands around it (logical px). */
export interface RoomFit {
  W: number
  H: number
  roomX: number
  roomY: number
  readout: Rect
  /** Bottom of the HUD's top band (ticker included). */
  bandTop: number
  /** Top of the HUD's bottom bar. */
  bandBottom: number
  sheetOpen: boolean
}

export function roomFit(page: Page): Promise<RoomFit> {
  return page.evaluate((): RoomFit => {
    const game = window.__pm!.game
    const wh = game.scene.getScene('Warehouse') as unknown as {
      stats(): {
        roomX: number
        roomY: number
        readout: Rect
        sheetOpen: boolean
      }
    }
    const hud = game.scene.getScene('HUD') as unknown as {
      L: {
        W: number
        H: number
        ticker: { y: number; h: number }
        bottomBar: { y: number }
      }
    }
    const s = wh.stats()
    const L = hud.L
    return {
      W: L.W,
      H: L.H,
      roomX: s.roomX,
      roomY: s.roomY,
      readout: s.readout,
      bandTop: L.ticker.y + L.ticker.h,
      bandBottom: L.bottomBar.y,
      sheetOpen: s.sheetOpen,
    }
  })
}

/**
 * warehouse-view.md §1.1: the readout strip and the 352×448 room sit inside
 * the screen and between the HUD bands, with no scrolling.
 */
export function expectRoomFits(f: RoomFit, label: string): void {
  console.log(`warehouse fit ${label}: ${JSON.stringify(f)}`)
  expect(f.roomX, `${label}: room left edge on screen`).toBeGreaterThanOrEqual(
    0,
  )
  expect(f.roomX + ROOM_W, `${label}: room right edge`).toBeLessThanOrEqual(f.W)
  expect(
    f.readout.y,
    `${label}: readout below the top band`,
  ).toBeGreaterThanOrEqual(f.bandTop)
  expect(
    f.readout.y + f.readout.h,
    `${label}: readout above the room`,
  ).toBeLessThanOrEqual(f.roomY)
  expect(
    f.roomY + ROOM_H,
    `${label}: room above the bottom bar`,
  ).toBeLessThanOrEqual(f.bandBottom)
}

/** A real tap at room px (x, y). */
export async function tapRoom(
  page: Page,
  pm: PmHelpers,
  x: number,
  y: number,
): Promise<void> {
  const f = await roomFit(page)
  await pm.tap(Math.round(f.roomX + x), Math.round(f.roomY + y))
}

/** A real tap at the centre of a room rect. */
export function tapRoomRect(page: Page, pm: PmHelpers, r: Rect): Promise<void> {
  return tapRoom(page, pm, r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2))
}

/**
 * Screen rect (logical px) of the live interactive object whose own or
 * container's data 'id' is `id` in scene `key` (the Button kit sets it),
 * through the first camera that renders its top container (cards drawn by
 * their own camera over an off-screen origin — the Dialog pattern).
 */
export function sceneTarget(
  page: Page,
  key: string,
  id: string,
): Promise<Rect | null> {
  return page.evaluate(
    ([k, want]) => {
      type Obj = {
        input: {
          enabled: boolean
          hitArea: { x: number; y: number; width: number; height: number }
        } | null
        active: boolean
        visible: boolean
        x: number
        y: number
        displayOriginX?: number
        displayOriginY?: number
        parentContainer: Obj | null
        cameraFilter: number
        getData?(d: string): unknown
      }
      type Cam = {
        id: number
        x: number
        y: number
        zoom: number
        scrollX: number
        scrollY: number
      }
      const scene = window.__pm!.game.scene.getScene(k!) as unknown as {
        input: Record<string, Obj[]>
        cameras: { cameras: Cam[] }
      }
      for (const o of scene.input['_list'] ?? []) {
        if (!o.input || !o.input.enabled || !o.active || !o.input.hitArea)
          continue
        let vis = o.visible
        let x = o.x - (o.displayOriginX ?? 0)
        let y = o.y - (o.displayOriginY ?? 0)
        let oid = (o.getData?.('id') as string | undefined) ?? ''
        let top = o
        for (let p = o.parentContainer; p; p = p.parentContainer) {
          vis = vis && p.visible
          x += p.x
          y += p.y
          if (!oid) oid = (p.getData?.('id') as string | undefined) ?? ''
          top = p
        }
        if (!vis || oid !== want) continue
        const cams = scene.cameras.cameras
        const cam =
          cams.find((c) => (top.cameraFilter & c.id) === 0) ?? cams[0]!
        const h = o.input.hitArea
        return {
          x: (x + h.x - cam.scrollX) * cam.zoom + cam.x,
          y: (y + h.y - cam.scrollY) * cam.zoom + cam.y,
          w: h.width * cam.zoom,
          h: h.height * cam.zoom,
        }
      }
      return null
    },
    [key, id] as const,
  )
}

/** A real tap on scene `key`'s target `id` (asserts it is live). */
export async function tapTarget(
  page: Page,
  pm: PmHelpers,
  key: string,
  id: string,
): Promise<void> {
  const r = await sceneTarget(page, key, id)
  expect(r, `${key} target ${id} is live`).not.toBeNull()
  await pm.tap(r!.x + Math.floor(r!.w / 2), r!.y + Math.floor(r!.h / 2))
}

/** Stop the ?policy=1 player (it Tosses every flag on the next tick). */
export function policyOff(page: Page): Promise<void> {
  return page.evaluate(() => {
    ;(window.__pm!.stepper as unknown as { policy: unknown }).policy = null
  })
}

export type WarehouseSheet = 'buy' | 'slot' | 'hold' | 'station' | 'hire'

/**
 * Which warehouse sheet is open: the HireSheet first (the card that opened
 * it closed itself), then the BuySheet, a slot's card, the Hold Bay card and
 * the StationCard; null when none.
 */
export function openSheet(page: Page): Promise<WarehouseSheet | null> {
  return page.evaluate(() => {
    const wh = window.__pm!.game.scene.getScene('Warehouse') as unknown as {
      buy: { isOpen(): boolean } | null
      slotCard: { isOpen(): boolean } | null
      holdCard: { isOpen(): boolean } | null
      stationCard: { isOpen(): boolean } | null
      hireSheet: { isOpen(): boolean } | null
    }
    if (wh.hireSheet?.isOpen()) return 'hire'
    if (wh.buy?.isOpen()) return 'buy'
    if (wh.slotCard?.isOpen()) return 'slot'
    if (wh.holdCard?.isOpen()) return 'hold'
    if (wh.stationCard?.isOpen()) return 'station'
    return null
  })
}

/** What an open HireSheet shows (null when the scene has none open). */
export interface HireSheetInfo {
  id: string
  role: string
  /** Applicant ids, card order. */
  ids: number[]
  names: string[]
}

/**
 * The open HireSheet of scene `key` ('Warehouse': its private `hireSheet`;
 * 'Garage': the `hireSheet` getter), read through casts.
 */
export function hireSheet(
  page: Page,
  key: 'Warehouse' | 'Garage',
): Promise<HireSheetInfo | null> {
  return page.evaluate((k) => {
    const sc = window.__pm!.game.scene.getScene(k) as unknown as {
      hireSheet: {
        isOpen(): boolean
        id: string
        opts: { role: string }
        cardModels: readonly { id: number; name: string }[]
      } | null
    }
    const hs = sc.hireSheet
    if (!hs?.isOpen()) return null
    const cards = hs.cardModels
    return {
      id: hs.id,
      role: hs.opts.role,
      ids: cards.map((c) => c.id),
      names: cards.map((c) => c.name),
    }
  }, key)
}

/** A real tap on the Hold Bay station (the StationCard, or the locked tooltip). */
export function tapStation(page: Page, pm: PmHelpers): Promise<void> {
  return tapRoomRect(page, pm, HOLD_STATION_HIT)
}

/**
 * Visible text of scene `key` (BitmapText / Text, containers walked, the
 * parents' visibility counted), in display order — card lines for asserts.
 */
export function sceneTexts(page: Page, key: string): Promise<string[]> {
  return page.evaluate((k) => {
    type Obj = {
      visible: boolean
      text?: unknown
      list?: Obj[]
    }
    const scene = window.__pm!.game.scene.getScene(k) as unknown as {
      children: { list: Obj[] }
    }
    const out: string[] = []
    const walk = (list: readonly Obj[]): void => {
      for (const o of list) {
        if (!o.visible) continue
        if (typeof o.text === 'string' && o.text !== '') out.push(o.text)
        if (Array.isArray(o.list)) walk(o.list)
      }
    }
    walk(scene.children.list)
    return out
  }, key)
}

/** The world scenes' state as the scene manager reports it. */
export function worlds(
  page: Page,
): Promise<{ city: string; warehouse: string }> {
  return page.evaluate(() => {
    const sm = window.__pm!.game.scene
    const state = (k: string): string =>
      sm.isSleeping(k) ? 'sleeping' : sm.isActive(k) ? 'active' : 'off'
    return { city: state('City'), warehouse: state('Warehouse') }
  })
}

/** Settle in 8-frame hops until `cond` holds (max `frames`). */
export async function settleUntil(
  page: Page,
  pm: PmHelpers,
  cond: () => Promise<boolean>,
  frames = 240,
): Promise<boolean> {
  for (let n = 0; n < frames; n += 8) {
    if (await cond()) return true
    await pm.settle(8)
  }
  return cond()
}
