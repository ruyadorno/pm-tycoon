// WorkerSprites (warehouse-view.md §1.12, §2.3, §3.3; spec-build2 §2.3-§2.6):
// one sprite per seated person — the 0–3 inspectors of EVERY desk fixture
// (desk 1 and desk 2, M6) and the sorter at the Hold Bay station. Each id in
// a desk's `inspectorIds` is bound, in order, to that desk slot's stand
// points w1–w3 (layout, by node id) facing the belt (east); the seated,
// active sorter (`ViewSim.holdStation`) stands at SORTER_STAND facing the
// rack (west). Frames `<stem>_{dir}_{idle_0,idle_1,walk_0,walk_1,scan_0,
// scan_1,jump}` (24 × 32, feet on row 28, origin (0.5, 1) placed 4 px below
// the feet so the ground shadow stays put on the jump); the stem comes from
// the person (`workerStem`: `worker_sorter` for a sorter, `worker` for an
// inspector, a per-look variant when the art has one) and falls back to
// `worker` frame by frame while the art is missing.
//
// State-derived: every frame the crews (lane desk fixtures + the station)
// are compared with the sprites — a new id walks in from the dock door
// (64 px/s along layout.walkPath / stationWalkPath), a missing one walks
// back out and is destroyed (a walked-out person carries `ic_alert`), a
// moved desk makes its crew walk to the new stand points. A payroll walkout
// (§7.4: `worker:walkedOut`; the sim moves an inspector to walkedOutIds, a
// sorter keeps the seat but goes inactive) walks them out carrying
// `ic_alert`; a re-hire walks them back in. `ic_alert` also sits over a desk
// (or the station) while someone seated there is unpaid (§1.6). idle (1 fps)
// while the person has nothing to do; an inspector scans (4 fps) while ITS
// station holds a parcel (one roll per inspector, B2 §2.3); the sorter scans
// while the station is working (a decision clock runs); `jump` for 300 ms on
// a lane flag (`jump()`; all, or one desk's crew) and for the sorter on its
// own Toss (`onSorterDecided`). Name tags (above the head) show for 1.5 s
// after a hire and while the desk's SlotCard (or the StationCard:
// `showNames(holdBayNodeId)`) is open. Reads `vs.people()` / `vs.holdStation` (design-m6 §3.4); nothing
// here changes sim timing.
import type Phaser from 'phaser'
import type { LaneNode, Station } from '../../sim/types.ts'
import type { ViewSim } from '../../sim/view-api.ts'
import { addText } from '../../ui/text.ts'
import { PALETTE, THEME } from '../../ui/theme.ts'
import { atlasOf, frameOrNull } from '../frames.ts'
import { moveAlong } from './Fx.ts'
import type { RoomLayers, RoomPerson, RoomStation } from './LaneRenderer.ts'
import {
  AISLE_X,
  DOOR_POINT,
  HOLD_STATION,
  SORTER_FACING,
  SORTER_STAND,
  type FixedLaneLayout,
  type Point,
} from './RoomLayout.ts'

export const WALK_PX_PER_S = 64
const IDLE_FPS = 1
const WALK_FPS = 6
const SCAN_FPS = 4
const JUMP_MS = 300
const TAG_MS = 1500
const FEET_DY = 4
/**
 * Name tag top relative to the feet: one 14-px text line right above the
 * 32-px sprite (its top is at feet + FEET_DY − 32), so a sheet that covers
 * a person's feet — the SlotCard at 360 × 604 — still shows the name of a
 * person whose head is in view (M6 review; it used to sit under the feet).
 */
const TAG_DY = FEET_DY - 32 - 14
/** Key of the station's unpaid badge in the alert map (desks use node ids). */
const STATION_KEY = '@station'

export type Dir = 's' | 'n' | 'e' | 'w'
export type Anim = 'idle' | 'walk' | 'scan' | 'jump'
type Img = Phaser.GameObjects.Image
type Txt = Phaser.GameObjects.BitmapText

const hasFrame = (f: string): boolean => frameOrNull(f) !== null

/**
 * The frame stem of a person's sprite (B2 §2.6, design-m6 §6.4-§6.5):
 * `worker_sorter` for a sorter (`worker` until that variant is drawn),
 * `worker` for an inspector; a per-look variant `<stem>_l<look>` (face index
 * 0–11) when the atlas has one, so look variants are an art-only change.
 */
export function workerStem(
  role: string,
  look: number,
  has: (frame: string) => boolean = hasFrame,
): string {
  const base =
    role === 'sorter' && has('worker_sorter_e_idle_0')
      ? 'worker_sorter'
      : 'worker'
  const v = `${base}_l${look}`
  return has(`${v}_e_idle_0`) ? v : base
}

/** `<stem>_<dir>_<anim>[_<k>]`, else the same frame of `worker`. */
export function workerFrame(
  stem: string,
  dir: Dir,
  anim: Anim,
  k: 0 | 1,
  has: (frame: string) => boolean = hasFrame,
): string {
  const tail = anim === 'jump' ? `${dir}_jump` : `${dir}_${anim}_${k}`
  const f = `${stem}_${tail}`
  return stem === 'worker' || has(f) ? f : `worker_${tail}`
}

/** Where one seated person stands. */
export interface CrewSeat {
  /** Desk slot node id; the sorter's is its Employee nodeId (the Hold Bay). */
  nodeId: string
  seat: number
  stand: Point
  /** Rest heading: the belt (e) for inspectors, the rack (w) for the sorter. */
  face: Dir
  /** True for the Hold Bay station's sorter. */
  station: boolean
}

/**
 * Who stands where now: every desk fixture's `inspectorIds` bound in order
 * to its node's stand points (desk 1 and desk 2 alike), plus the station's
 * sorter while seated AND active (a walked-out sorter keeps the seat in the
 * sim but leaves the room until re-hired). Employee id → seat.
 */
export function crewSeats(
  nodes: readonly LaneNode[],
  layout: Pick<FixedLaneLayout, 'standPoints'>,
  station: RoomStation | null,
): Map<number, CrewSeat> {
  const out = new Map<number, CrewSeat>()
  for (const n of nodes) {
    if (n.fixture?.kind !== 'desk') continue
    const stands = layout.standPoints(n.id)
    if (stands.length === 0) continue
    n.fixture.inspectorIds.forEach((id, seat) => {
      const stand = stands[Math.min(seat, stands.length - 1)] as Point
      out.set(id, {
        nodeId: n.id,
        seat,
        stand: { ...stand },
        face: 'e',
        station: false,
      })
    })
  }
  const s = station?.kind === 'sorter' ? station.sorter : null
  if (s && s.active) {
    out.set(s.id, {
      nodeId: s.nodeId ?? 'hold',
      seat: 0,
      stand: { ...SORTER_STAND },
      face: SORTER_FACING,
      station: true,
    })
  }
  return out
}

/** The station an inspector works (its `employeeId`, else its seat index). */
function stationOf(
  node: LaneNode,
  employeeId: number,
  seat: number,
): Station | null {
  const sts = node.stations
  return sts.find((s) => s.employeeId === employeeId) ?? sts[seat] ?? null
}

interface Worker {
  id: number
  stem: string
  img: Img
  tag: Txt
  alert: Img | null
  nodeId: string
  seat: number
  station: boolean
  face: Dir
  /** Feet position. */
  x: number
  y: number
  dir: Dir
  walking: boolean
  leaving: boolean
  tween: Phaser.Tweens.Tween | null
  tagUntil: number
  jumpUntil: number
}

export class WorkerSprites {
  readonly scene: Phaser.Scene
  private L: RoomLayers
  private layout: FixedLaneLayout
  private vs: ViewSim
  private workers = new Map<number, Worker>()
  private phase = 0
  private namesFor: string | null = null
  /** ic_alert per desk node id (and STATION_KEY) while someone there is unpaid. */
  private unpaid = new Map<string, Img>()
  private walkedOut = new Set<number>()
  private byId = new Map<number, RoomPerson>()

  constructor(
    scene: Phaser.Scene,
    layers: RoomLayers,
    layout: FixedLaneLayout,
    vs: ViewSim,
  ) {
    this.scene = scene
    this.L = layers
    this.layout = layout
    this.vs = vs
  }

  private refreshPeople(): void {
    this.byId.clear()
    for (const p of this.vs.people()) this.byId.set(p.id, p)
  }

  /** Person name for a card / tooltip (null when unknown). */
  nameOf(id: number): string | null {
    return this.byId.get(id)?.name ?? null
  }

  /** Rebuild from state at once (create / WAKE): no walking. */
  syncAll(): void {
    for (const w of this.workers.values()) this.destroyWorker(w)
    this.workers.clear()
    this.walkedOut.clear()
    for (const a of this.unpaid.values()) a.setVisible(false)
    this.reconcile(true)
  }

  /** worker:walkedOut — the sprite leaves carrying the alert icon. */
  onWalkedOut(employeeId: number): void {
    if (this.workers.has(employeeId)) this.walkedOut.add(employeeId)
  }

  /** sorter:decided — the sorter jumps on its own Toss (B2 §2.6). */
  onSorterDecided(p: { employeeId: number; call: string }): void {
    if (p.call !== 'toss') return
    const w = this.workers.get(p.employeeId)
    if (w && !w.leaving) w.jumpUntil = this.scene.time.now + JUMP_MS
  }

  /** True while the sprite of `employeeId` is on its way out (tests / e2e). */
  isLeaving(employeeId: number): boolean {
    return this.workers.get(employeeId)?.leaving === true
  }

  /** True while the sprite of `employeeId` walks (in, out, or to a moved desk). */
  isWalking(employeeId: number): boolean {
    return this.workers.get(employeeId)?.walking === true
  }

  /** Feet position of `employeeId`'s sprite in room px, or null (tests / e2e). */
  positionOf(employeeId: number): Point | null {
    const w = this.workers.get(employeeId)
    return w ? { x: w.x, y: w.y } : null
  }

  /**
   * A lane flag: everyone jumps for 300 ms (§3.3, fun addition), or only the
   * crew of desk `nodeId` when given.
   */
  jump(nodeId?: string): void {
    const until = this.scene.time.now + JUMP_MS
    for (const w of this.workers.values()) {
      if (nodeId === undefined || (!w.station && w.nodeId === nodeId))
        w.jumpUntil = until
    }
  }

  /**
   * Show name tags while a card is open (null = hide): a desk's SlotCard
   * passes its node id, the StationCard the Hold Bay node id (the sorter's
   * Employee nodeId).
   */
  showNames(nodeId: string | null): void {
    this.namesFor = nodeId
  }

  private reconcile(instant: boolean): void {
    this.refreshPeople()
    const want = crewSeats(
      this.vs.lane.nodes(),
      this.layout,
      this.vs.holdStation,
    )
    for (const [id, s] of want) {
      const w = this.workers.get(id)
      if (!w) {
        this.spawn(id, s, instant)
        continue
      }
      if (w.leaving) continue
      if (w.nodeId !== s.nodeId || w.seat !== s.seat) {
        w.nodeId = s.nodeId
        w.seat = s.seat
        if (instant) this.place(w, s.stand.x, s.stand.y, w.face)
        else this.walk(w, this.relocatePath(w, s))
      }
    }
    for (const w of this.workers.values()) {
      if (w.leaving || want.has(w.id)) continue
      if (instant) {
        this.destroyWorker(w)
        this.workers.delete(w.id)
      } else this.walkOut(w)
    }
  }

  private spawn(id: number, s: CrewSeat, instant: boolean): void {
    const person = this.byId.get(id)
    const stem = workerStem(
      person?.role ?? (s.station ? 'sorter' : 'inspector'),
      person?.look ?? 0,
    )
    const f0 = workerFrame(stem, s.face, 'idle', 0)
    const img = this.scene.add.image(0, 0, atlasOf(f0), f0).setOrigin(0.5, 1)
    const tag = addText(this.scene, 0, 0, person?.name ?? '', {
      tint: PALETTE.grey5,
      shadow: true,
    })
    tag.setVisible(false)
    this.L.workers.add([img, tag])
    const w: Worker = {
      id,
      stem,
      img,
      tag,
      alert: null,
      nodeId: s.nodeId,
      seat: s.seat,
      station: s.station,
      face: s.face,
      x: s.stand.x,
      y: s.stand.y,
      dir: s.face,
      walking: false,
      leaving: false,
      tween: null,
      tagUntil: instant ? -1 : this.scene.time.now + TAG_MS,
      jumpUntil: -1,
    }
    this.workers.set(id, w)
    if (instant) {
      this.place(w, s.stand.x, s.stand.y, s.face)
      return
    }
    // Hire (§1.12): in through the dock door along the aisle (the sorter
    // then crosses south of the rack to the station).
    this.place(w, DOOR_POINT.x, DOOR_POINT.y, 'e')
    const path = s.station
      ? this.layout.stationWalkPath()
      : this.layout.walkPath(s.nodeId, s.stand)
    this.walk(w, path.slice(1))
  }

  private relocatePath(w: Worker, s: CrewSeat): Point[] {
    if (s.station) return [{ ...s.stand }]
    const r = this.layout.rectFor(s.nodeId)
    const y = r ? r.y + 36 : s.stand.y
    return [
      { x: AISLE_X, y: w.y },
      { x: AISLE_X, y },
      { x: s.stand.x, y },
      s.stand,
    ]
  }

  private walkOut(w: Worker): void {
    w.leaving = true
    if (this.walkedOut.has(w.id)) {
      this.walkedOut.delete(w.id)
      w.alert = this.scene.add.image(0, 0, atlasOf('ic_alert'), 'ic_alert')
      this.L.workers.add(w.alert)
    }
    // The sorter leaves the way it came (south of the rack) unless it is
    // still on the aisle (fired mid-walk-in).
    const pts =
      w.station && w.x > AISLE_X
        ? this.layout.stationExitPath({ x: w.x, y: w.y })
        : [
            { x: AISLE_X, y: w.y },
            { x: AISLE_X, y: DOOR_POINT.y },
            { ...DOOR_POINT },
          ]
    this.walk(w, pts, () => {
      this.destroyWorker(w)
      this.workers.delete(w.id)
    })
  }

  private walk(w: Worker, pts: Point[], onDone?: () => void): void {
    w.tween?.stop()
    w.walking = true
    const pos = { x: w.x, y: w.y }
    const obj = {
      x: w.x,
      y: w.y,
      setPosition: (x: number, y: number) => {
        const dx = x - pos.x
        const dy = y - pos.y
        if (Math.abs(dx) + Math.abs(dy) > 0.01) {
          w.dir =
            Math.abs(dx) >= Math.abs(dy)
              ? dx > 0
                ? 'e'
                : 'w'
              : dy > 0
                ? 's'
                : 'n'
        }
        pos.x = x
        pos.y = y
        obj.x = x
        obj.y = y
        this.place(w, x, y, w.dir)
      },
    }
    w.tween = moveAlong(this.scene, obj, pts, {
      pxPerS: WALK_PX_PER_S,
      minMs: 0,
      maxMs: 60_000,
      onDone: () => {
        w.tween = null
        w.walking = false
        this.place(w, w.x, w.y, w.face)
        onDone?.()
      },
    })
  }

  private place(w: Worker, x: number, y: number, dir: Dir): void {
    w.x = Math.round(x)
    w.y = Math.round(y)
    w.dir = dir
    w.img.setPosition(w.x, w.y + FEET_DY)
    w.tag.setPosition(Math.round(w.x - w.tag.width / 2), w.y + TAG_DY)
    w.alert?.setPosition(w.x, w.y - 34)
  }

  private destroyWorker(w: Worker): void {
    w.tween?.stop()
    w.img.destroy()
    w.tag.destroy()
    w.alert?.destroy()
  }

  /** Set `f` on `img`, switching texture if `f` lives in another atlas. */
  private setFrame(img: Img, f: string): void {
    if (img.frame.name === f) return
    const atlas = atlasOf(f)
    if (img.texture.key !== atlas) img.setTexture(atlas, f)
    else img.setFrame(f)
  }

  update(time: number, delta: number): void {
    this.reconcile(false)
    this.phase += delta
    const nodes = new Map(this.vs.lane.nodes().map((n) => [n.id, n]))
    const station = this.vs.holdStation
    const k = (fps: number): 0 | 1 =>
      Math.floor(this.phase / (1000 / fps)) % 2 === 0 ? 0 : 1
    for (const w of this.workers.values()) {
      let anim: Anim
      let kk: 0 | 1 = 0
      if (w.walking) {
        anim = 'walk'
        kk = k(WALK_FPS)
      } else if (time < w.jumpUntil) {
        anim = 'jump'
      } else if (this.busy(w, nodes, station)) {
        anim = 'scan'
        kk = k(SCAN_FPS)
      } else {
        anim = 'idle'
        kk = k(IDLE_FPS)
      }
      this.setFrame(w.img, workerFrame(w.stem, w.dir, anim, kk))
      const showTag =
        time < w.tagUntil ||
        (this.namesFor !== null && w.nodeId === this.namesFor)
      w.tag.setVisible(showTag && !w.leaving)
    }
    this.updateUnpaid(nodes, station)
  }

  /** Scanning: the inspector's own station holds a parcel; the sorter's clock runs. */
  private busy(
    w: Worker,
    nodes: ReadonlyMap<string, LaneNode>,
    station: RoomStation | null,
  ): boolean {
    if (w.leaving) return false
    if (w.station) return station?.working === true
    const n = nodes.get(w.nodeId)
    return n ? (stationOf(n, w.id, w.seat)?.parcelId ?? null) !== null : false
  }

  /** ic_alert over every desk (and the station) with an unpaid person (§1.6, §7.4). */
  private updateUnpaid(
    nodes: ReadonlyMap<string, LaneNode>,
    station: RoomStation | null,
  ): void {
    const on = new Map<string, Point>()
    for (const n of nodes.values()) {
      if (n.fixture?.kind !== 'desk') continue
      const r = this.layout.rectFor(n.id)
      if (!r) continue
      const unpaid = n.fixture.inspectorIds.some(
        (id) => this.byId.get(id)?.unpaid === true,
      )
      if (unpaid) on.set(n.id, { x: 104, y: r.y + 8 })
    }
    const s = station?.kind === 'sorter' ? station.sorter : null
    if (s && s.active && s.unpaid)
      on.set(STATION_KEY, { x: HOLD_STATION.x + 8, y: HOLD_STATION.y + 8 })
    for (const [key, img] of this.unpaid)
      if (!on.has(key)) img.setVisible(false)
    for (const [key, at] of on) {
      let img = this.unpaid.get(key)
      if (!img) {
        img = this.scene.add
          .image(0, 0, atlasOf('ic_alert'), 'ic_alert')
          .setOrigin(0.5, 0.5)
        this.L.badges.add(img)
        this.unpaid.set(key, img)
      }
      img.setPosition(at.x, at.y).setVisible(true)
    }
  }

  destroy(): void {
    for (const w of this.workers.values()) this.destroyWorker(w)
    this.workers.clear()
    for (const a of this.unpaid.values()) a.destroy()
    this.unpaid.clear()
  }

  /** For tests / debug: worker count incl. walking ones. */
  get count(): number {
    return this.workers.size
  }
}

/** Light text for name tags on the floor (kept here for the theme import). */
export const NAME_TAG_TINT = THEME.textLight
