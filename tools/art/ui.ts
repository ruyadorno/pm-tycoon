// UI drawers (style-guide.md §1.7, §2.8; city-view.md §4, warehouse-view.md
// §1.6-§4): NineSlice frames with 4-px corners (16x16 canvas), plus the
// fixed strips (banner, badges, bars, sheet handle, title sign).
//
// Panel style (§1.7): cream `grey5` face, 1-px `outline` border, 2-px `grey3`
// bevel on the bottom/right; dark panels `grey0`; buttons `blue1` primary /
// `grey4` secondary / `red1` / `grass1` confirm (ui_btn_green + _down, the
// Hold Bay CLEAR face) with a 2-px lip that collapses to a 1-px top shadow when
// pressed (the face shifts down 1 px and darkens one step); disabled = flat
// `grey3`; chips are pills (active `yellow2`); bars 8 px tall, `grey3` track;
// the Hold Bay card border is `mal1` (2 px).
//
// NineSlice insets for scenes: every 16x16 frame here uses 4/4/4/4; the 8x8
// bar frames use 3/3 horizontally (3-slice, 2-px stretch column); badges and
// the sheet handle are fixed-size images.

import type { DrawCtx } from './draw-api.ts'
import { registerDrawer } from './drawers.ts'
import { CARDBOARD, Grid, box3q, gridFrames } from './icons.ts'

/** corner insets per row from the outer edge: soft 4-px panel corner */
const SOFT = [2, 1] as const
/** pill corner (chips, badges) */
const PILL = [3, 1, 1] as const
/** tiny corner (bars) */
const CUT = [1] as const

/** inside-mask of a rounded rectangle with symmetric corner insets */
function roundMask(w: number, h: number, ins: readonly number[]) {
  return (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false
    const ry = Math.min(y, h - 1 - y)
    const k = ins[ry] ?? 0
    return x >= k && x < w - k
  }
}

/** rounded rect only on the top corners (tabs) */
function topRoundMask(w: number, h: number, ins: readonly number[]) {
  return (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false
    const k = ins[y] ?? 0
    return x >= k && x < w - k
  }
}

type Mask = (x: number, y: number) => boolean

/**
 * Fill a shape: outline on its boundary, then `paint(x, y, ring)` for every
 * interior pixel, where ring = distance in px from the outline (1 = touching
 * it) measured along x and y separately as [fromLeft, fromTop, fromRight,
 * fromBottom].
 */
function shapeGrid(
  w: number,
  h: number,
  inside: Mask,
  paint: (
    x: number,
    y: number,
    d: [number, number, number, number],
  ) => string | null,
  border = 'outline',
): Grid {
  const g = new Grid(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue
      const edge =
        !inside(x - 1, y) ||
        !inside(x + 1, y) ||
        !inside(x, y - 1) ||
        !inside(x, y + 1)
      if (edge) {
        g.set(x, y, border)
        continue
      }
      let l = 1
      while (inside(x - l - 1, y)) l++
      let t = 1
      while (inside(x, y - t - 1)) t++
      let r = 1
      while (inside(x + r + 1, y)) r++
      let b = 1
      while (inside(x, y + b + 1)) b++
      g.set(x, y, paint(x, y, [l, t, r, b]))
    }
  }
  return g
}

const N = 16

// ---------------------------------------------------------------------------
// Panels and cards

function panel(): Grid {
  return shapeGrid(N, N, roundMask(N, N, SOFT), (_x, _y, [, , r, b]) =>
    r <= 2 || b <= 2 ? 'grey3' : 'grey5',
  )
}

function panelDark(): Grid {
  return shapeGrid(N, N, roundMask(N, N, SOFT), (_x, _y, [l, t]) =>
    t === 1 || l === 1 ? 'grey1' : 'grey0',
  )
}

function cardHeld(): Grid {
  return shapeGrid(N, N, roundMask(N, N, SOFT), (_x, _y, [l, t, r, b]) => {
    if (l <= 2 || t <= 2 || r <= 2 || b <= 2) return 'mal1'
    if (r === 3 || b === 3) return 'grey3'
    return 'grey5'
  })
}

/**
 * build 2 M7 (design-m7 §6.1, §6.3, §6.6): the quest / victory card — the
 * ui_panel face inside a 2-px gold ramp border (gold2 lit on the top/left,
 * gold0 on the bottom/right, gold1 inner ring), the panel's grey3 bevel
 * one ring further in. NineSlice 4/4/4/4 like every 16x16 panel.
 */
function cardGold(): Grid {
  return shapeGrid(N, N, roundMask(N, N, SOFT), (_x, _y, [l, t, r, b]) => {
    const ring = Math.min(l, t, r, b)
    if (ring === 1) return r === 1 || b === 1 ? 'gold0' : 'gold2'
    if (ring === 2) return 'gold1'
    if (r === 3 || b === 3) return 'grey3'
    return 'grey5'
  })
}

function tooltip(): Grid {
  return shapeGrid(N, N, roundMask(N, N, SOFT), (_x, _y, [, , r, b]) =>
    b === 1 || r === 1 ? 'yellow1' : 'yellow3',
  )
}

function tag(): Grid {
  const g = shapeGrid(N, N, roundMask(N, N, SOFT), (_x, _y, [, t, , b]) =>
    t === 1 ? 'yellow3' : b === 1 ? 'yellow1' : 'yellow2',
  )
  // rivets in the four corner slices (corners never stretch)
  for (const [x, y] of [
    [3, 3],
    [12, 3],
    [3, 11],
    [12, 11],
  ] as const) {
    g.set(x, y, 'yellow0')
  }
  return g
}

function tab(): Grid {
  return shapeGrid(N, N, topRoundMask(N, N, SOFT), (_x, _y, [, , r]) =>
    r === 1 ? 'grey4' : 'grey5',
  )
}

// ---------------------------------------------------------------------------
// Buttons: [face, highlight, lip] up and [face, highlight, top shadow] down

interface BtnStyle {
  face: string
  hi: string
  lip: string
}

const BTN: Readonly<Record<string, { up: BtnStyle; down: BtnStyle }>> = {
  grey: {
    up: { face: 'grey4', hi: 'grey5', lip: 'grey3' },
    down: { face: 'grey3', hi: 'grey4', lip: 'grey2' },
  },
  blue: {
    up: { face: 'blue1', hi: 'blue2', lip: 'blue0' },
    down: { face: 'blue0', hi: 'blue1', lip: 'outline' },
  },
  red: {
    up: { face: 'red1', hi: 'red2', lip: 'red0' },
    down: { face: 'red0', hi: 'red1', lip: 'outline' },
  },
  glow: {
    up: { face: 'yellow2', hi: 'yellow3', lip: 'yellow1' },
    down: { face: 'yellow1', hi: 'yellow2', lip: 'yellow0' },
  },
  // confirm (Hold Bay CLEAR): the grass ramp, pressed lip one step darker
  // into leaf0 (the blue/red faces use `outline` there; leaf0 keeps it green)
  green: {
    up: { face: 'grass1', hi: 'grass2', lip: 'grass0' },
    down: { face: 'grass0', hi: 'grass1', lip: 'leaf0' },
  },
}

function btnUp(s: BtnStyle): Grid {
  return shapeGrid(N, N, roundMask(N, N, SOFT), (_x, _y, [, t, , b]) =>
    b <= 2 ? s.lip : t === 1 ? s.hi : s.face,
  )
}

function btnDown(s: BtnStyle): Grid {
  return shapeGrid(N, N, roundMask(N, N, SOFT), (_x, _y, [, t]) =>
    t === 1 ? s.lip : t === 2 ? s.hi : s.face,
  )
}

function btnOff(): Grid {
  return shapeGrid(N, N, roundMask(N, N, SOFT), (_x, _y, [, , , b]) =>
    b === 1 ? 'grey2' : 'grey3',
  )
}

/** 1 Hz attention ring drawn over a button (transparent centre) */
function btnRing(on: boolean): Grid {
  const outer = roundMask(N, N, SOFT)
  return shapeGrid(N, N, outer, (_x, _y, [l, t, r, b]) => {
    const k = Math.min(l, t, r, b)
    if (k === 1) return on ? 'yellow3' : 'yellow1'
    if (k === 2) return on ? 'yellow2' : 'yellow0'
    if (k === 3) return 'outline'
    return null
  })
}

// ---------------------------------------------------------------------------
// Chips, badges, bars, handle

function chip(active: boolean): Grid {
  const [face, hi, lip] = active
    ? ['yellow2', 'yellow3', 'yellow1']
    : ['grey4', 'grey5', 'grey3']
  return shapeGrid(N, N, roundMask(N, N, PILL), (_x, _y, [, t, , b]) =>
    b === 1 ? lip : t === 1 ? hi : face,
  )
}

function badge(w: number, h: number): Grid {
  return shapeGrid(w, h, roundMask(w, h, PILL), (_x, _y, [, t, , b]) =>
    b === 1 ? 'grey3' : t === 1 ? 'grey5' : 'grey5',
  )
}

/** 3x5-ish pixel word for the 20x10 NEW badge (UI chrome, not a sprite name) */
const NEW_WORD = [
  'X..X.XXX.X...X',
  'XX.X.X...X...X',
  'X.XX.XX..X.X.X',
  'X..X.X...X.X.X',
  'X..X.XXX..X.X.',
]

function badgeNew(): Grid {
  const w = 20
  const h = 10
  const g = shapeGrid(w, h, roundMask(w, h, [2, 1]), (_x, _y, [, t]) =>
    t === 1 ? 'pink1' : 'pink0',
  )
  NEW_WORD.forEach((row, j) => {
    for (let i = 0; i < row.length; i++)
      if (row[i] === 'X') g.set(3 + i, 2 + j, 'grey5')
  })
  return g
}

function sheetHandle(): Grid {
  const g = new Grid(40, 8)
  const s = shapeGrid(40, 6, roundMask(40, 6, [2, 1]), (_x, _y, [, t]) =>
    t === 1 ? 'grey4' : 'grey3',
  )
  g.blit(s, 0, 1)
  return g
}

function barTrack(): Grid {
  return shapeGrid(8, 8, roundMask(8, 8, CUT), (_x, _y, [, t]) =>
    t === 1 ? 'grey2' : 'grey3',
  )
}

function barFill(face: string, hi: string, lo: string): Grid {
  return shapeGrid(8, 8, roundMask(8, 8, CUT), (_x, _y, [, t, , b]) =>
    t === 1 ? hi : b === 1 ? lo : face,
  )
}

// ---------------------------------------------------------------------------
// Banner (CLOSE CALL!, 320x32) and the Title company sign (128x48)

function banner(): Grid {
  const w = 320
  const h = 32
  const g = new Grid(w, h)
  // ribbon tails, lower and behind the body, with a V notch on the outside
  const tail = (x0: number, flip: boolean) => {
    const tw = 18
    const tg = shapeGrid(
      tw,
      24,
      (x, y) => {
        if (x < 0 || y < 0 || x >= tw || y >= 24) return false
        const notch = 6 - Math.abs(y - 11.5) * 0.5
        const xx = flip ? tw - 1 - x : x
        return xx >= Math.max(0, Math.round(notch))
      },
      (_x, _y, [, t]) => (t === 1 ? 'red1' : 'red0'),
    )
    g.blit(tg, x0, 8)
  }
  tail(0, false)
  tail(w - 18, true)
  // folds where the body meets the tails
  for (let i = 0; i < 4; i++) {
    g.hline(10, 13 - i, 26 + i, 'outline')
    g.hline(w - 14 + i, w - 11, 26 + i, 'outline')
  }
  const body = shapeGrid(
    w - 20,
    28,
    roundMask(w - 20, 28, [1]),
    (_x, _y, [, t, , b]) => {
      if (t === 1) return 'red2'
      if (b <= 2) return 'red0'
      if (t === 3 || b === 4) return 'yellow2'
      return 'red1'
    },
  )
  g.blit(body, 10, 0)
  return g
}

function signTitle(): Grid {
  const w = 128
  const h = 48
  const g = new Grid(w, h)
  // two posts the board stands on
  for (const px of [20, w - 24]) {
    g.rect(px, 36, 4, 12, 'outline')
    g.rect(px + 1, 36, 2, 11, 'grey2')
    g.vline(px + 1, 36, 46, 'grey3')
  }
  const board = shapeGrid(
    w,
    40,
    roundMask(w, 40, SOFT),
    (_x, _y, [l, t, r, b]) => {
      const k = Math.min(l, t, r, b)
      if (k <= 2) return t <= 2 || l <= 2 ? 'orange2' : 'orange1'
      if (k === 3) return 'outline'
      if (t === 4) return 'blue2'
      if (b === 4 || b === 5) return 'blue0'
      return 'blue1'
    },
  )
  g.blit(board, 0, 0)
  // emblem: a parcel on the left of the board (text area x 34..121)
  box3q(g, 8, 9, 20, 20, CARDBOARD)
  g.hline(9, 28, 29, 'outline')
  g.vline(28, 10, 29, 'outline')
  // bolts
  for (const [x, y] of [
    [5, 5],
    [w - 6, 5],
    [5, 33],
    [w - 6, 33],
  ] as const) {
    g.set(x, y, 'grey4')
  }
  return g
}

// ---------------------------------------------------------------------------
// Registration

const SINGLE: Record<string, () => Grid> = {
  ui_panel: panel,
  ui_panel_dark: panelDark,
  ui_card_held: cardHeld,
  ui_card_gold: cardGold,
  ui_tooltip: tooltip,
  ui_tag: tag,
  ui_tab: tab,
  ui_btn: () => btnUp((BTN.grey as { up: BtnStyle }).up),
  ui_btn_down: () => btnDown((BTN.grey as { down: BtnStyle }).down),
  ui_btn_off: btnOff,
  ui_btn_primary: () => btnUp((BTN.blue as { up: BtnStyle }).up),
  ui_btn_primary_down: () => btnDown((BTN.blue as { down: BtnStyle }).down),
  ui_btn_red: () => btnUp((BTN.red as { up: BtnStyle }).up),
  ui_btn_red_down: () => btnDown((BTN.red as { down: BtnStyle }).down),
  ui_btn_glow: () => btnUp((BTN.glow as { up: BtnStyle }).up),
  ui_chip: () => chip(false),
  ui_chip_active: () => chip(true),
  ui_badge: () => badge(40, 16),
  badge_new: badgeNew,
  ui_sheet_handle: sheetHandle,
  ui_bar_track: barTrack,
  ui_bar_fill_green: () => barFill('grass2', 'grass3', 'grass1'),
  ui_bar_fill_amber: () => barFill('yellow2', 'yellow3', 'yellow1'),
  ui_bar_fill_red: () => barFill('red1', 'red2', 'red0'),
  ui_bar_fill_blue: () => barFill('blue1', 'blue2', 'blue0'),
  // build 2 M7: the quest chip / QuestCard progress bar (gold = reward)
  ui_bar_fill_gold: () => barFill('gold1', 'gold2', 'gold0'),
  ui_banner: banner,
  sign_title: signTitle,
}

for (const [id, build] of Object.entries(SINGLE)) {
  registerDrawer({ id }, (d: DrawCtx) =>
    gridFrames(
      d,
      d.entry.frames.map(() => build()),
    ),
  )
}

// ui_btn_green: one id, frames '' (up) and '_down' (pressed)
registerDrawer({ id: 'ui_btn_green' }, (d: DrawCtx) => {
  const s = BTN.green as { up: BtnStyle; down: BtnStyle }
  return gridFrames(
    d,
    d.entry.frames.map((f) => (f === '_down' ? btnDown(s.down) : btnUp(s.up))),
  )
})

registerDrawer({ id: 'ui_btn_ring' }, (d: DrawCtx) =>
  gridFrames(
    d,
    d.entry.frames.map((s) => btnRing(s === '_0')),
  ),
)
