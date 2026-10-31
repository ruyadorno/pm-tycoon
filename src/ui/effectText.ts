// Build 3 M12 (B3 §3.3–§3.4): the EventCard's pure text model — the card's
// constants, the effects-row and flow wrapping, the card layout and the small
// shared helpers the HUD, the EffectsCard, the lost-life / game-over variants
// and the event paper use. Phaser-free (tools/check-sim-purity.mjs) so Vitest
// loads it under Node; `measure` is the m5x7 BitmapText width of a string.
import type { GameData, ModifierKey } from '../data/types.ts'
import type { FrameName } from '../render/frames.ts'
import type { EffectLine } from '../sim/systems/effects.ts'
import type { OpenCardView } from '../sim/view-api.ts'
import type { Layout, Rect } from './layout.ts'
import { formatQuestTime } from './questText.ts'
import { ellipsize, formatMoney, LINE_H } from './text.ts'
import { PALETTE, THEME } from './theme.ts'

// ---- constants (card-local px) ------------------------------------------------

/** ≤ W − 12, like QuestCard (QUEST_CARD_W). */
export const EVENT_CARD_W = 300
export const EVENT_CARD_PAD = 12
/** Above the bottom bar. */
export const EVENT_CARD_GAP = 8
/** B3 §3.4: the copy-fit test's limit (rendering never clips). */
export const EVENT_CARD_MAX_H = 340
/** QUEST_CARD_DEPTH: above sheets, under popovers 7000 / tooltips 9500. */
export const EVENT_CARD_DEPTH = 6000
export const EVENT_CARD_IN_MS = 300
export const EVENT_MAST_H = 24
/** The double rule at 26 and 28 (QuestCard). */
export const EVENT_RULE_Y = 26
export const EVENT_PIC = 48
export const EVENT_PIC_X = 12
export const EVENT_PIC_Y = 32
/** The picture inset: a 1-px outline rect; the grey3 fill sits at +1 (50×50). */
export const EVENT_INSET = { x: 10, y: 30, w: 52, h: 52 } as const
/** EVENT_INSET.y + h. */
export const EVENT_INSET_BOTTOM = 82
/** The inset's right edge 62 + 4. */
export const EVENT_TEXT_X = 66
export const EVENT_TEXT_TOP = 32
export const EVENT_PARENT_LINES = 2
export const EVENT_TITLE_LINES = 1
export const EVENT_BODY_LINES = 4
export const EVENT_OBJECTIVE_LINES = 2
/** Text bottom → the thin rule. */
export const EVENT_RULE_GAP = 4
/** The thin rule (1 px) → the first button. */
export const EVENT_OPTS_GAP = 6
export const EVENT_BTN_H = 44
/** Button bottom → its first effects row. */
export const EVENT_ROWS_GAP = 2
export const EVENT_EFFECT_ROWS = 2
export const EVENT_OPT_GAP = 6
export const EVENT_BOTTOM_PAD = 8
export const EVENT_SEP = ' · '
export const EVENT_PAUSED_TEXT = 'PAUSED'
/** Enter on a card whose first option is danger / unaffordable (D-M12-2). */
export const EVENT_ENTER_DENY = 'Tap an option'
/** The greyed row's fallback reason (puns.json eventWords.cantAfford). */
export const EVENT_CANT_AFFORD = "Can't afford"
/**
 * Air between a button label and the face's edges: Button.ts CONTENT_PAD
 * (not imported — Button.ts imports Phaser; tests/ui/event-card.test.ts
 * pins the two equal). A label wider than inner − 2·this is an overflow.
 */
export const EVENT_LABEL_PAD = 5
export const EVENT_PILL_H = 16
export const EVENT_PILL_Y = 4
export const EVENT_PILL_PAD = 4
/** Effect tones on the light ui_panel (the ShieldPopover TONE_TEXT family). */
export const EFFECT_TONE_TINT = {
  cost: PALETTE.red0,
  gain: PALETTE.grass0,
  neutral: PALETTE.grey1,
  disabled: PALETTE.grey2,
} as const
export const EVENT_TITLE_TINT = PALETTE.gold0
export const EVENT_MUTED = PALETTE.grey1
export const EVENT_DARK = THEME.textDark

// ---- types --------------------------------------------------------------------

export type EffectTone = 'cost' | 'gain' | 'neutral' | 'disabled'
/** JS string indices into the row's `text`. */
export interface EffectSpan {
  from: number
  len: number
  tone: EffectTone
}
/** One BitmapText per row. */
export interface EffectRow {
  text: string
  spans: readonly EffectSpan[]
}
export type EventCardMode = 'decision' | 'three' | 'job' | 'news'
export type EventFace = 'primary' | 'secondary' | 'red'
export interface FlowLine {
  kind: 'parent' | 'title' | 'body' | 'objective'
  text: string
  x: number
  y: number
  tint: number
}
export interface OptionLayout {
  /** EventOptionView.index (the data index; button ids are `event:opt${index}`). */
  index: number
  label: string
  face: EventFace
  enabled: boolean
  reason: string | null
  /** Button top. */
  y: number
  rows: readonly EffectRow[]
  /** The first row's top (= y + 46). */
  rowsY: number
  /** {x: 12, y, w: inner, h: 44 + rowsH}: the button + its rows (Button `hit`). */
  hit: Rect
  /** The lines needed more than EVENT_EFFECT_ROWS rows. */
  overflow: boolean
  /** A line ends in `this can end the run`. */
  endsRun: boolean
  /** The label is wider than the button's text room (inner − 2·EVENT_LABEL_PAD; labels never wrap). */
  labelOverflow: boolean
}
export interface EventCardInput extends Pick<
  OpenCardView,
  | 'eventId'
  | 'kind'
  | 'word'
  | 'picture'
  | 'title'
  | 'body'
  | 'day'
  | 'parentChoice'
  | 'options'
> {
  /** Job cards: questText.objectiveText of quests().offer (D-M12-6). */
  objective?: string | null
}
export interface EventCardLayout {
  eventId: string
  w: number
  h: number
  mode: EventCardMode
  /** v.word (`STAFF`, `JOB BOARD`). */
  masthead: string
  /** `Day ${v.day}`. */
  day: string
  /** v.picture. */
  picture: string
  flow: readonly FlowLine[]
  overflow: {
    parent: boolean
    title: boolean
    body: boolean
    objective: boolean
  }
  ruleY: number
  options: readonly OptionLayout[]
  /** The option index Enter takes (D-M12-2); null → Enter denies. */
  enter: number | null
  /** h ≤ EVENT_CARD_MAX_H and no overflow anywhere (texts, rows, labels). */
  fits: boolean
}

// ---- the card model --------------------------------------------------------------

/**
 * job → 'job'; the data's news kind → 'news' (never a decision card whose `if`
 * hid all but one option: M12 critique 5); three visible options → 'three';
 * else 'decision'.
 */
export function eventCardMode(
  v: Pick<OpenCardView, 'kind' | 'options'>,
): EventCardMode {
  if (v.kind === 'job') return 'job'
  if (v.kind === 'news') return 'news'
  if (v.options.length === 3) return 'three'
  return 'decision'
}

/** The text column for a row whose top is `top`: beside the picture, then full width. */
export function eventColumn(
  top: number,
  w = EVENT_CARD_W,
): { x: number; w: number } {
  return top < EVENT_INSET_BOTTOM
    ? { x: EVENT_TEXT_X, w: w - EVENT_CARD_PAD - EVENT_TEXT_X }
    : { x: EVENT_CARD_PAD, w: w - 2 * EVENT_CARD_PAD }
}

/**
 * Greedy word wrap of `text` from `top`: line i has top `top + 14·i` and is
 * as wide as `column(its top)` gives (so a body runs beside the picture for
 * its first rows and at full width after). Long words stay whole. Words left
 * after `maxLines` give `overflow` and the last line runs on, cut with `…`
 * (wrapHeadline's rule); a single word wider than its line gives `overflow`
 * and that line is cut with `…` too, so the card never draws past its edge.
 * Empty text gives no lines.
 */
export function wrapFlow(
  text: string,
  top: number,
  maxLines: number,
  column: (rowTop: number) => { x: number; w: number },
  measure: (s: string) => number,
): { lines: { text: string; x: number; y: number }[]; overflow: boolean } {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: { text: string; x: number; y: number }[] = []
  if (words.length === 0) return { lines, overflow: false }
  if (maxLines <= 0) return { lines, overflow: true }
  const at = (k: number): { x: number; y: number; w: number } => {
    const y = top + LINE_H * k
    const c = column(y)
    return { x: c.x, y, w: c.w }
  }
  const push = (t: string): void => {
    const c = at(lines.length)
    lines.push({ text: t, x: c.x, y: c.y })
  }
  let overflow = false
  let line = ''
  let i = 0
  for (; i < words.length; i++) {
    const w = words[i] as string
    const next = line ? `${line} ${w}` : w
    if (!line || measure(next) <= at(lines.length).w) {
      line = next
      continue
    }
    push(line)
    line = w
    if (lines.length === maxLines) break
  }
  if (lines.length < maxLines) {
    if (line) push(line)
  } else {
    // Out of lines with words left: the last line runs on and is cut.
    overflow = true
    const last = lines[maxLines - 1] as { text: string }
    const rest = [line, ...words.slice(i + 1)].join(' ')
    last.text = ellipsize(`${last.text} ${rest}`, at(maxLines - 1).w, measure)
  }
  lines.forEach((l, k) => {
    const w = at(k).w
    if (measure(l.text) <= w) return
    overflow = true
    l.text = ellipsize(l.text, w, measure)
  })
  return { lines, overflow }
}

/** A run of one tone inside a row being built. */
interface Part {
  text: string
  tone: EffectTone
}

/** How a row joins the next one in a run-on: a segment break or a word break. */
interface RowDraft {
  parts: Part[]
  join: 'seg' | 'word' | null
}

const partsText = (parts: readonly Part[]): string =>
  parts.map((p) => p.text).join('')

/** The neutral separator part between two segments. */
const sep = (): Part => ({ text: EVENT_SEP, tone: 'neutral' })

/**
 * The words of a segment for wrapping. A lone `—` / `·` / `–` sticks to the
 * word before it, so a continuation row never starts with a dash or the
 * separator (M12 critique 23).
 */
function segWords(text: string): string[] {
  const out: string[] = []
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (out.length > 0 && (w === '—' || w === '·' || w === '–'))
      out[out.length - 1] += ` ${w}`
    else out.push(w)
  }
  return out
}

/** One tone per JS string index of the parts' text. */
function toneChars(parts: readonly Part[]): { ch: string; tone: EffectTone }[] {
  const out: { ch: string; tone: EffectTone }[] = []
  for (const p of parts)
    for (let i = 0; i < p.text.length; i++)
      out.push({ ch: p.text.charAt(i), tone: p.tone })
  return out
}

/** The row from tone-tagged characters: spans merge adjacent equal tones. */
function rowOf(chars: readonly { ch: string; tone: EffectTone }[]): EffectRow {
  const spans: EffectSpan[] = []
  let text = ''
  for (const c of chars) {
    const last = spans[spans.length - 1]
    if (last && last.tone === c.tone) last.len += c.ch.length
    else spans.push({ from: text.length, len: c.ch.length, tone: c.tone })
    text += c.ch
  }
  return { text, spans }
}

/**
 * Cut tone-tagged characters to `maxW` with `…` (ellipsize's rule: trailing
 * spaces and a dangling separator go first); the `…` takes the tone of the
 * first visible character it replaces.
 */
function cutChars(
  chars: readonly { ch: string; tone: EffectTone }[],
  maxW: number,
  measure: (s: string) => number,
): { ch: string; tone: EffectTone }[] {
  const str = (n: number): string =>
    chars
      .slice(0, n)
      .map((c) => c.ch)
      .join('')
  if (measure(str(chars.length)) <= maxW) return chars.slice()
  const trimmed = (n: number): number => {
    let m = n
    for (;;) {
      while (m > 0 && chars[m - 1]?.ch === ' ') m--
      if (m > 0 && chars[m - 1]?.ch === '·') {
        m--
        continue
      }
      return m
    }
  }
  let n = chars.length
  while (n > 0 && measure(str(trimmed(n)) + '…') > maxW) n--
  const m = trimmed(n)
  let tone: EffectTone = chars[m]?.tone ?? 'neutral'
  for (let k = m; k < chars.length; k++) {
    const c = chars[k] as { ch: string; tone: EffectTone }
    if (c.ch !== ' ' && c.ch !== '·') {
      tone = c.tone
      break
    }
  }
  return [...chars.slice(0, m), { ch: '…', tone }]
}

/**
 * The option's effects lines joined with EVENT_SEP into ≤ `maxRows` rows of
 * `maxW` px, segment first: a line that does not fit after the separator
 * moves whole to the next row; a line wider than a row on its own is
 * word-wrapped (each word keeps its tone; a continuation row starts with
 * the next word). A line that itself holds ` · ` is split into segments
 * there first, so no row starts or ends with the separator (critique 23).
 * More rows than `maxRows` → `overflow`; the last row runs on and is cut
 * with `…`. Spans are JS string indices into each row's text (the glyphs
 * used are all in the BMP), adjacent equal tones merged; the separator is
 * neutral.
 */
export function effectRows(
  lines: readonly EffectLine[],
  maxW: number,
  measure: (s: string) => number,
  maxRows = EVENT_EFFECT_ROWS,
): { rows: EffectRow[]; overflow: boolean } {
  const segs: Part[] = []
  for (const l of lines) {
    if (l.text.trim() === '') continue
    for (const piece of l.text.split(EVENT_SEP)) {
      const t = piece.trim()
      if (t !== '') segs.push({ text: t, tone: l.tone })
    }
  }
  const drafts: RowDraft[] = []
  let cur: Part[] = []
  for (const seg of segs) {
    const have = partsText(cur)
    if (measure(have ? `${have}${EVENT_SEP}${seg.text}` : seg.text) <= maxW) {
      if (cur.length > 0) cur.push(sep())
      cur.push(seg)
      continue
    }
    if (cur.length > 0) drafts.push({ parts: cur, join: 'seg' })
    cur = []
    if (measure(seg.text) <= maxW) {
      cur = [seg]
      continue
    }
    let line = ''
    for (const w of segWords(seg.text)) {
      const next = line ? `${line} ${w}` : w
      if (!line || measure(next) <= maxW) {
        line = next
        continue
      }
      drafts.push({ parts: [{ text: line, tone: seg.tone }], join: 'word' })
      line = w
    }
    if (line) cur = [{ text: line, tone: seg.tone }]
  }
  if (cur.length > 0) drafts.push({ parts: cur, join: null })

  let overflow = false
  let kept = drafts
  if (drafts.length > maxRows && maxRows > 0) {
    overflow = true
    const runOn: Part[] = []
    for (let k = maxRows - 1; k < drafts.length; k++) {
      const d = drafts[k] as RowDraft
      runOn.push(...d.parts)
      if (k < drafts.length - 1) {
        const tone = d.parts[d.parts.length - 1]?.tone ?? 'neutral'
        runOn.push(d.join === 'word' ? { text: ' ', tone } : sep())
      }
    }
    kept = [...drafts.slice(0, maxRows - 1), { parts: runOn, join: null }]
  } else if (drafts.length > maxRows) {
    return { rows: [], overflow: true }
  }
  const rows = kept.map((d) => {
    const chars = toneChars(d.parts)
    const text = chars.map((c) => c.ch).join('')
    if (measure(text) <= maxW) return rowOf(chars)
    overflow = true
    return rowOf(cutChars(chars, maxW, measure))
  })
  return { rows, overflow }
}

/**
 * A greyed option's single row: the reason plus the price (`Can't afford ·
 * $150`, D-M12-3; the reason alone for a free option), all `disabled`.
 */
export function disabledRow(reason: string | null, cost: number): EffectRow {
  const why = reason ?? EVENT_CANT_AFFORD
  const text = cost > 0 ? `${why}${EVENT_SEP}${formatMoney(cost)}` : why
  return { text, spans: [{ from: 0, len: text.length, tone: 'disabled' }] }
}

/**
 * The card's full geometry at width `w` (B3 §3.4): the parent line (links),
 * the title (1 line, gold), the body (≤ 4, muted) and a job's objective
 * (≤ 2, dark) beside the 48-px picture then full width; the thin rule under
 * max(the text, the picture inset); then per visible option a 44-px
 * full-width button (primary first, red for danger, secondary otherwise)
 * with its effects rows (≤ 2) or, greyed, the reason row under it. Enter
 * takes the first option unless it is danger or greyed (D-M12-2; a news
 * card's single OK always). `fits` = h ≤ EVENT_CARD_MAX_H with no overflow
 * in any text, row or button label (the copy-fit test's verdict).
 */
export function layoutEventCard(
  v: EventCardInput,
  measure: (s: string) => number,
  w = EVENT_CARD_W,
): EventCardLayout {
  const inner = w - 2 * EVENT_CARD_PAD
  const column = (top: number): { x: number; w: number } => eventColumn(top, w)
  const flow: FlowLine[] = []
  const overflow = {
    parent: false,
    title: false,
    body: false,
    objective: false,
  }
  let y = EVENT_TEXT_TOP
  const put = (
    kind: FlowLine['kind'],
    text: string,
    maxLines: number,
    tint: number,
  ): number => {
    const r = wrapFlow(text, y, maxLines, column, measure)
    for (const l of r.lines)
      flow.push({ kind, text: l.text, x: l.x, y: l.y, tint })
    overflow[kind] = r.overflow
    return r.lines.length
  }
  if (v.parentChoice !== null && v.parentChoice.trim() !== '')
    y += LINE_H * put('parent', v.parentChoice, EVENT_PARENT_LINES, EVENT_MUTED)
  put('title', v.title, EVENT_TITLE_LINES, EVENT_TITLE_TINT)
  y += LINE_H * EVENT_TITLE_LINES
  y += LINE_H * put('body', v.body, EVENT_BODY_LINES, EVENT_MUTED)
  if (v.objective)
    y +=
      LINE_H * put('objective', v.objective, EVENT_OBJECTIVE_LINES, EVENT_DARK)
  const ruleY = Math.max(EVENT_INSET_BOTTOM, y) + EVENT_RULE_GAP
  y = ruleY + 1 + EVENT_OPTS_GAP

  const options: OptionLayout[] = []
  v.options.forEach((o, i) => {
    const enabled = o.affordable
    const r = enabled
      ? effectRows(o.lines, inner, measure)
      : { rows: [disabledRow(o.reason, o.cost)], overflow: false }
    const rowsH =
      r.rows.length > 0 ? EVENT_ROWS_GAP + LINE_H * r.rows.length : 0
    options.push({
      index: o.index,
      label: o.label,
      face: o.danger ? 'red' : i === 0 ? 'primary' : 'secondary',
      enabled,
      reason: o.reason,
      y,
      rows: r.rows,
      rowsY: y + EVENT_BTN_H + EVENT_ROWS_GAP,
      hit: { x: EVENT_CARD_PAD, y, w: inner, h: EVENT_BTN_H + rowsH },
      overflow: r.overflow,
      endsRun: endsRun(o.lines),
      labelOverflow: measure(o.label) > inner - 2 * EVENT_LABEL_PAD,
    })
    y += EVENT_BTN_H + rowsH + EVENT_OPT_GAP
  })
  const h = y - EVENT_OPT_GAP + EVENT_BOTTOM_PAD
  const mode = eventCardMode(v)
  const first = options[0]
  const enter =
    first === undefined
      ? null
      : mode === 'news' || (first.enabled && first.face !== 'red')
        ? first.index
        : null
  return {
    eventId: v.eventId,
    w,
    h,
    mode,
    masthead: v.word,
    day: `Day ${v.day}`,
    picture: v.picture,
    flow,
    overflow,
    ruleY,
    options,
    enter,
    fits:
      h <= EVENT_CARD_MAX_H &&
      !overflow.parent &&
      !overflow.title &&
      !overflow.body &&
      !overflow.objective &&
      options.every((o) => !o.overflow && !o.labelOverflow),
  }
}

/**
 * What makes a laid-out card not fit, for the copy-fit test's failure line
 * (`h 355 > 340`, `body`, `option 1 rows`, `option 0 label`); [] when it fits.
 */
export function eventCardMisfits(m: EventCardLayout): string[] {
  const out: string[] = []
  if (m.h > EVENT_CARD_MAX_H) out.push(`h ${m.h} > ${EVENT_CARD_MAX_H}`)
  for (const k of ['parent', 'title', 'body', 'objective'] as const)
    if (m.overflow[k]) out.push(k)
  for (const o of m.options) {
    if (o.overflow) out.push(`option ${o.index} rows`)
    if (o.labelOverflow) out.push(`option ${o.index} label`)
  }
  return out
}

// ---- shared helpers (real in wave 0) -------------------------------------------

/**
 * The card's screen rect for a card `h` px tall: centred, EVENT_CARD_GAP above
 * the bottom bar, never above the ticker (questCardRect generalised with h).
 */
export function eventCardRect(
  L: Pick<Layout, 'W' | 'bottomBar' | 'ticker'>,
  h: number,
): Rect {
  const w = Math.min(EVENT_CARD_W, Math.round(L.W) - 12)
  const y = Math.max(
    L.ticker.y + L.ticker.h,
    L.bottomBar.y - EVENT_CARD_GAP - h,
  )
  return { x: Math.round((L.W - w) / 2), y: Math.round(y), w, h }
}

/** A line of the option ends in `this can end the run` (effects.ts lifeLine). */
export function endsRun(lines: readonly EffectLine[]): boolean {
  return lines.some((l) => l.text.endsWith('this can end the run'))
}

/** `Abc` → `abc` (the first character only). */
export function lowerFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1)
}

/**
 * `The recall — you chose: Take the strike` (the GameOverCard variant and the
 * event paper's headline).
 */
export function eventChoiceLine(
  data: Pick<GameData, 'puns'>,
  title: string,
  option: string,
): string {
  return `${title} — ${lowerFirst(data.puns.eventWords.youChose.replaceAll('{option}', option))}`
}

/** Every modifier key's EffectsCard icon (all `ic_*` world frames). */
const MODIFIER_ICON: Readonly<Record<ModifierKey, FrameName>> = {
  speed: 'ic_speed2',
  stop: 'ic_parcel_m',
  inspectorP: 'ic_person',
  machineP: 'ic_shield',
  processS: 'ic_warehouse',
  payrollMult: 'ic_money',
  payrollAdd: 'ic_money',
  income: 'ic_money',
  tossBounty: 'ic_money',
  wrongTossFee: 'ic_money',
  malwareShare: 'ic_bomb',
  decoyShare: 'ic_alert',
  spawn: 'ic_parcel_s',
  vehiclePrice: 'ic_garage',
  machinePrice: 'ic_warehouse',
  onTimeMaxS: 'ic_check',
  clearanceS: 'ic_ship',
  shelfCap: 'ic_parcel_l',
}

export function modifierIcon(key: ModifierKey): FrameName {
  return MODIFIER_ICON[key]
}

/** `permanent` for null, else `1d 0h left` (formatQuestTime). */
export function timeLeftText(ticksLeft: number | null): string {
  return ticksLeft === null ? 'permanent' : `${formatQuestTime(ticksLeft)} left`
}
