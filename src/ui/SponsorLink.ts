// The sponsor link (author request, 2026-10-31; docs/decisions.md "After M15 —
// the sponsor link"): `Sponsored by vlt technology`, the name in an accent
// tint over an underline, opening https://vlt.io in a new tab. The Title draws
// it centred at its bottom at 32 px (m5x7's 2×: the underline, its shadow and
// the text's shadow are 2 px there, like the City's level stamp) and
// left-aligned at 16 px in its Credits card.
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
import { FONT_SIZE, THEME } from './theme.ts'

export const SPONSOR_PREFIX = 'Sponsored by'
export const SPONSOR_NAME = 'vlt technology'
export const SPONSOR_TEXT = `${SPONSOR_PREFIX} ${SPONSOR_NAME}`
export const SPONSOR_URL = 'https://vlt.io'
/**
 * The underline's row below the text top at 16 px: m5x7's descenders (g, y)
 * end on row 12 (base 11), so row 14 leaves one clear row under them. Every
 * row and offset doubles at 32 px.
 */
export const UNDERLINE_Y = 14

export interface SponsorLinkOptions {
  /** The line's left edge, or its centre with align 'center' (parent px). */
  x: number
  /** The BitmapText top (parent px). */
  y: number
  align?: 'left' | 'center'
  /** 16 (default) or 32: m5x7's two crisp sizes. */
  size?: 16 | 32
  /** `Sponsored by`. */
  tint: number
  /** `vlt technology` and its underline. */
  linkTint: number
  /** Black drop shadow, 1 px per 16 px of size (city overlay text, style-guide §1.7). */
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
  const size = opts.size ?? FONT_SIZE
  // m5x7's pixel at this size: every row, the underline and the shadow scale by it.
  const k = size / FONT_SIZE
  const text = (s: string, tint: number): Phaser.GameObjects.BitmapText => {
    const t = addText(scene, 0, 0, s, { size, tint })
    if (shadow) t.setDropShadow(k, k, THEME.shadow, 1)
    return t
  }
  const prefix = text(SPONSOR_TEXT, opts.tint)
  // The name's x from the full line's width (the space's advance included).
  const w = textWidth(prefix)
  prefix.setText(SPONSOR_PREFIX)
  const name = text(SPONSOR_NAME, opts.linkTint)
  name.setX(w - textWidth(name))
  const underline = (dx: number, tint: number): Phaser.GameObjects.Rectangle =>
    scene.add
      .rectangle(name.x + dx, UNDERLINE_Y * k + dx, name.width, k, tint)
      .setOrigin(0, 0)
  // What the press look shifts down 1 px (the underline's shadow first).
  const looks: (
    | Phaser.GameObjects.BitmapText
    | Phaser.GameObjects.Rectangle
  )[] = [
    prefix,
    name,
    ...(shadow ? [underline(k, THEME.shadow)] : []),
    underline(0, opts.linkTint),
  ]
  const ink = { x: 0, y: CAP_TOP * k, w, h: (UNDERLINE_Y + 2 - CAP_TOP) * k }
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
