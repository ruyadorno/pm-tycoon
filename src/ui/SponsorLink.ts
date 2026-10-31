// The sponsor link (author request, 2026-10-31; docs/decisions.md "After M15 —
// the sponsor link"): `Sponsored by vlt technology`, the name in an accent
// tint over a 1-px underline, opening https://vlt.io in a new tab. The Title
// draws it centred at its bottom and left-aligned in its Credits card.
//
// A tap = pointerdown then pointerup on the hit zone with at most TAP_PX of
// travel (Button's rule); the line drops 1 px while pressed and the tap emits
// `ui:tap` (the tap sfx). window.open runs inside the pointerup: Phaser's
// InputManager handles DOM input events synchronously, so it lands inside a
// user activation — on touch screens touchend is activation-triggering (iOS:
// touchstart is not — never open on pointerdown); with a mouse the mouseup
// still holds the activation its mousedown granted (about 5 s in Chromium),
// so pop-up blockers let it through. The hit zone is the line's ink rect (cap
// top to the underline's shadow) grown to minHit (ceil(44 / zoom)) on each
// axis.
import Phaser from 'phaser'
import { TAP_PX } from './Button.ts'
import { growTo, minHitFor } from './layout.ts'
import { addText, CAP_TOP, textWidth } from './text.ts'
import { THEME } from './theme.ts'

export const SPONSOR_PREFIX = 'Sponsored by'
export const SPONSOR_NAME = 'vlt technology'
export const SPONSOR_TEXT = `${SPONSOR_PREFIX} ${SPONSOR_NAME}`
export const SPONSOR_URL = 'https://vlt.io'
/**
 * The underline's row below the text top: m5x7's descenders (g, y) end on
 * row 12 (base 11), so row 14 leaves one clear row under them.
 */
export const UNDERLINE_Y = 14

export interface SponsorLinkOptions {
  /** The line's left edge, or its centre with align 'center' (parent px). */
  x: number
  /** The BitmapText top (parent px). */
  y: number
  align?: 'left' | 'center'
  /** `Sponsored by`. */
  tint: number
  /** `vlt technology` and its underline. */
  linkTint: number
  /** 1-px black drop shadow (city overlay text, style-guide §1.7). */
  shadow?: boolean
  /** Data 'id' of the hit zone (e2e selectors) and the `ui:tap` payload. */
  id: string
  /** Asked on each tap: false swallows it (a modal is up, a game is starting). */
  canOpen?: () => boolean
}

/** Open the sponsor's site in a new tab, without a handle back to the game. */
export function openSponsor(): void {
  try {
    window.open(SPONSOR_URL, '_blank', 'noopener')
  } catch {
    // a refused pop-up never breaks the Title
  }
}

/** The sponsor line as a Container at an integer top-left; see the header. */
export function addSponsorLink(
  scene: Phaser.Scene,
  opts: SponsorLinkOptions,
): Phaser.GameObjects.Container {
  const shadow = opts.shadow === true
  const prefix = addText(scene, 0, 0, SPONSOR_TEXT, {
    tint: opts.tint,
    shadow,
  })
  // The name's x from the full line's width (the space's advance included).
  const w = textWidth(prefix)
  prefix.setText(SPONSOR_PREFIX)
  const name = addText(scene, 0, 0, SPONSOR_NAME, {
    tint: opts.linkTint,
    shadow,
  })
  name.setX(w - textWidth(name))
  const underline = (dx: number, tint: number): Phaser.GameObjects.Rectangle =>
    scene.add
      .rectangle(name.x + dx, UNDERLINE_Y + dx, name.width, 1, tint)
      .setOrigin(0, 0)
  // What the press look shifts down 1 px (the underline's shadow first).
  const looks: (
    | Phaser.GameObjects.BitmapText
    | Phaser.GameObjects.Rectangle
  )[] = [
    prefix,
    name,
    ...(shadow ? [underline(1, THEME.shadow)] : []),
    underline(0, opts.linkTint),
  ]
  const ink = { x: 0, y: CAP_TOP, w, h: UNDERLINE_Y + 2 - CAP_TOP }
  const hit = growTo(ink, minHitFor(scene.scale.zoom))
  const zone = scene.add.zone(hit.x, hit.y, hit.w, hit.h).setOrigin(0, 0)
  zone.setData('id', opts.id)

  const left = opts.align === 'center' ? opts.x - w / 2 : opts.x
  const root = scene.add.container(Math.round(left), Math.round(opts.y), [
    ...looks,
    zone,
  ])
  const base = looks.map((o) => o.y)
  let pressed = false
  const press = (on: boolean): void => {
    pressed = on
    looks.forEach((o, i) => o.setY(base[i]! + (on ? 1 : 0)))
  }
  zone.setInteractive({ useHandCursor: true })
  zone.on('pointerdown', () => press(true))
  zone.on('pointerout', () => press(false))
  zone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    const wasPressed = pressed
    press(false)
    if (!wasPressed || pointer.getDistance() > TAP_PX) return
    if (opts.canOpen && !opts.canOpen()) return
    scene.game.events.emit('ui:tap', { id: opts.id })
    openSponsor()
  })
  return root
}
