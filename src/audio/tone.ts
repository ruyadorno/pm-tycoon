// The only Tone.js entry point (audio.md §2: Tone is the clock — getTransport, setContext, start — and nothing
// else). Never `import ... from 'tone'`: its index module evaluates `getContext().transport` (and Destination,
// Listener, Draw) at import time, which in a browser creates a second AudioContext before setContext can run.
// The deep imports below load only the global-context module and the Transport module (whose onContextInit hook
// gives every Tone Context its Transport). No Tone audio node is ever created by this project.
import type { TransportClass } from 'tone/build/esm/core/clock/Transport.js'
// oxlint-disable-next-line import/no-unassigned-import -- registers the Transport on every Tone Context
import 'tone/build/esm/core/clock/Transport.js'
import { getContext, setContext, start } from 'tone/build/esm/core/Global.js'

let bound: AudioContext | null = null

/** Hands the shared context to Tone (once, before any Tone object exists) and sets its look-ahead. */
export function bindToneClock(ctx: AudioContext, lookAhead = 0.15): void {
  if (bound === ctx) return
  setContext(ctx)
  getContext().lookAhead = lookAhead
  bound = ctx
}

export function isToneBound(): boolean {
  return bound !== null
}

export function getTransport(): TransportClass {
  return getContext().transport
}

/** Tone's notion of "now": the context time plus the look-ahead. */
export function toneNow(): number {
  return getContext().now()
}

/** Same as Tone.start(): resumes the (shared) context. */
export function toneStart(): Promise<void> {
  return start()
}
