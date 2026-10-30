// WorkerSprites (warehouse-view.md §1.12, §2.3, §3.3): the 1–3 inspectors
// seated at the desk. Each inspector id in the desk fixture's `inspectorIds`
// is bound, in order, to the desk slot's stand points w1–w3 (layout, by node
// id) facing the belt (east). Frames `worker_{dir}_{idle_0,idle_1,walk_0,
// walk_1,scan_0,scan_1,jump}` (24 × 32, feet on row 28, origin (0.5, 1)
// placed 4 px below the feet so the ground shadow stays put on the jump).
//
// State-derived: every frame the desk's inspector list is compared with the
// sprites — a new id walks in from the dock door (64 px/s along
// layout.walkPath), a missing one walks back out and is destroyed (a
// walked-out inspector carries `ic_alert`), a moved desk makes everyone walk
// to the new stand points. A payroll walkout (§7.4: `worker:walkedOut`, the
// sim moves the id to the desk's walkedOutIds and drops a station) walks the
// inspector back out through the dock door at 64 px/s carrying `ic_alert`; a
// re-hire (`worker:hired`) walks them back in. `ic_alert` also sits over the
// desk while any seated inspector carries an unpaid mark (§1.6: from
// `payroll:short` until a paid payday clears it). idle (1 fps) while the
// desk has no parcel, scan (4 fps, all together: one shared roll, §6.3)
// while any station is busy, `jump` for 300 ms on any lane flag. Name tags
// show for 1.5 s after a hire and while the desk's SlotCard is open.
// Nothing here changes sim timing.
import type Phaser from 'phaser'
import type { Employee, LaneNode } from '../../sim/types.ts'
import type { ViewSim } from '../../sim/view-api.ts'
import { addText } from '../../ui/text.ts'
import { PALETTE, THEME } from '../../ui/theme.ts'
import { atlasOf } from '../frames.ts'
import { moveAlong } from './Fx.ts'
import type { RoomLayers } from './LaneRenderer.ts'
import { DOOR_POINT, type FixedLaneLayout, type Point } from './RoomLayout.ts'

export const WALK_PX_PER_S = 64
const IDLE_FPS = 1
const WALK_FPS = 6
const SCAN_FPS = 4
const JUMP_MS = 300
const TAG_MS = 1500
const FEET_DY = 4
const AISLE_X = 56

type Dir = 's' | 'n' | 'e' | 'w'
type Img = Phaser.GameObjects.Image
type Txt = Phaser.GameObjects.BitmapText

interface Worker {
  id: number
  img: Img
  tag: Txt
  alert: Img | null
  nodeId: string
  seat: number
  /** Feet position. */
  x: number
  y: number
  dir: Dir
  walking: boolean
  leaving: boolean
  tween: Phaser.Tweens.Tween | null
  tagUntil: number
}

export class WorkerSprites {
  readonly scene: Phaser.Scene
  private L: RoomLayers
  private layout: FixedLaneLayout
  private vs: ViewSim
  private employees: () => readonly Employee[]
  private workers = new Map<number, Worker>()
  private phase = 0
  private jumpUntil = -1
  private namesFor: string | null = null
  private unpaid: Img
  private walkedOut = new Set<number>()

  constructor(
    scene: Phaser.Scene,
    layers: RoomLayers,
    layout: FixedLaneLayout,
    vs: ViewSim,
    employees: () => readonly Employee[],
  ) {
    this.scene = scene
    this.L = layers
    this.layout = layout
    this.vs = vs
    this.employees = employees
    this.unpaid = scene.add
      .image(0, 0, atlasOf('ic_alert'), 'ic_alert')
      .setOrigin(0.5, 0.5)
      .setVisible(false)
    layers.badges.add(this.unpaid)
  }

  private desk(): LaneNode | null {
    return this.vs.lane.nodes().find((n) => n.fixture?.kind === 'desk') ?? null
  }

  private employee(id: number): Employee | null {
    return this.employees().find((e) => e.id === id) ?? null
  }

  /** Inspector name for a card / tooltip (null when unknown). */
  nameOf(id: number): string | null {
    return this.employee(id)?.name ?? null
  }

  /** Rebuild from state at once (create / WAKE): no walking. */
  syncAll(): void {
    for (const w of this.workers.values()) this.destroyWorker(w)
    this.workers.clear()
    this.walkedOut.clear()
    this.reconcile(true)
  }

  /** worker:walkedOut — the sprite leaves carrying the alert icon. */
  onWalkedOut(employeeId: number): void {
    if (this.workers.has(employeeId)) this.walkedOut.add(employeeId)
  }

  /** True while the sprite of `employeeId` is on its way out (tests / e2e). */
  isLeaving(employeeId: number): boolean {
    return this.workers.get(employeeId)?.leaving === true
  }

  /** Any lane flag: everyone jumps for 300 ms (§3.3, fun addition). */
  jump(): void {
    this.jumpUntil = this.scene.time.now + JUMP_MS
  }

  /** Show name tags while the desk's SlotCard is open (null = hide). */
  showNames(nodeId: string | null): void {
    this.namesFor = nodeId
  }

  private reconcile(instant: boolean): void {
    const desk = this.desk()
    const ids = desk?.fixture?.kind === 'desk' ? desk.fixture.inspectorIds : []
    const stands = desk ? this.layout.standPoints(desk.id) : []
    ids.forEach((id, seat) => {
      if (!desk) return
      const stand = stands[Math.min(seat, stands.length - 1)]
      if (!stand) return
      const w = this.workers.get(id)
      if (!w) {
        this.spawn(id, desk.id, seat, stand, instant)
        return
      }
      if (w.leaving) return
      if (w.nodeId !== desk.id || w.seat !== seat) {
        w.nodeId = desk.id
        w.seat = seat
        if (instant) this.place(w, stand.x, stand.y, 'e')
        else this.walk(w, this.relocatePath(w, desk.id, stand))
      }
    })
    for (const w of this.workers.values()) {
      if (w.leaving || ids.includes(w.id)) continue
      if (instant) {
        this.destroyWorker(w)
        this.workers.delete(w.id)
      } else this.walkOut(w)
    }
  }

  private spawn(
    id: number,
    nodeId: string,
    seat: number,
    stand: Point,
    instant: boolean,
  ): void {
    const img = this.scene.add
      .image(0, 0, atlasOf('worker_e_idle_0'), 'worker_e_idle_0')
      .setOrigin(0.5, 1)
    const tag = addText(this.scene, 0, 0, this.nameOf(id) ?? '', {
      tint: PALETTE.grey5,
      shadow: true,
    })
    tag.setVisible(false)
    this.L.workers.add([img, tag])
    const w: Worker = {
      id,
      img,
      tag,
      alert: null,
      nodeId,
      seat,
      x: stand.x,
      y: stand.y,
      dir: 'e',
      walking: false,
      leaving: false,
      tween: null,
      tagUntil: instant ? -1 : this.scene.time.now + TAG_MS,
    }
    this.workers.set(id, w)
    if (instant) {
      this.place(w, stand.x, stand.y, 'e')
      return
    }
    // Hire (§1.12): in through the dock door along the aisle.
    this.place(w, DOOR_POINT.x, DOOR_POINT.y, 'e')
    this.walk(w, this.layout.walkPath(nodeId, stand).slice(1))
  }

  private relocatePath(w: Worker, nodeId: string, stand: Point): Point[] {
    const r = this.layout.rectFor(nodeId)
    const y = r ? r.y + 36 : stand.y
    return [{ x: AISLE_X, y: w.y }, { x: AISLE_X, y }, { x: stand.x, y }, stand]
  }

  private walkOut(w: Worker): void {
    w.leaving = true
    if (this.walkedOut.has(w.id)) {
      this.walkedOut.delete(w.id)
      w.alert = this.scene.add.image(0, 0, atlasOf('ic_alert'), 'ic_alert')
      this.L.workers.add(w.alert)
    }
    const pts = [
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
        w.dir = 'e'
        this.place(w, w.x, w.y, 'e')
        onDone?.()
      },
    })
  }

  private place(w: Worker, x: number, y: number, dir: Dir): void {
    w.x = Math.round(x)
    w.y = Math.round(y)
    w.dir = dir
    w.img.setPosition(w.x, w.y + FEET_DY)
    w.tag.setPosition(Math.round(w.x - w.tag.width / 2), w.y + 4)
    w.alert?.setPosition(w.x, w.y - 34)
  }

  private destroyWorker(w: Worker): void {
    w.tween?.stop()
    w.img.destroy()
    w.tag.destroy()
    w.alert?.destroy()
  }

  update(time: number, delta: number): void {
    this.reconcile(false)
    this.phase += delta
    const desk = this.desk()
    const scanning = desk?.stations.some((s) => s.parcelId !== null) ?? false
    const jumping = time < this.jumpUntil
    for (const w of this.workers.values()) {
      let f: string
      if (w.walking) {
        const k = Math.floor(this.phase / (1000 / WALK_FPS)) % 2
        f = `worker_${w.dir}_walk_${k}`
      } else if (jumping) {
        f = `worker_${w.dir}_jump`
      } else if (scanning) {
        const k = Math.floor(this.phase / (1000 / SCAN_FPS)) % 2
        f = `worker_${w.dir}_scan_${k}`
      } else {
        const k = Math.floor(this.phase / (1000 / IDLE_FPS)) % 2
        f = `worker_${w.dir}_idle_${k}`
      }
      if (w.img.frame.name !== f) w.img.setFrame(f)
      const showTag =
        time < w.tagUntil ||
        (this.namesFor !== null && w.nodeId === this.namesFor)
      w.tag.setVisible(showTag && !w.leaving)
    }
    // Unpaid badge above the desk (§1.6, §7.4): any seated inspector unpaid.
    const unpaid =
      desk?.fixture?.kind === 'desk' &&
      desk.fixture.inspectorIds.some(
        (id) => (this.employee(id)?.unpaidPaydays ?? 0) > 0,
      )
    const r = desk ? this.layout.rectFor(desk.id) : null
    this.unpaid.setVisible(Boolean(unpaid && r))
    if (unpaid && r) this.unpaid.setPosition(104, r.y + 8)
  }

  destroy(): void {
    for (const w of this.workers.values()) this.destroyWorker(w)
    this.workers.clear()
  }

  /** For tests / debug: worker count incl. walking ones. */
  get count(): number {
    return this.workers.size
  }
}

/** Light text for name tags on the floor (kept here for the theme import). */
export const NAME_TAG_TINT = THEME.textLight
