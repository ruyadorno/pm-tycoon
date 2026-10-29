// The one AudioContext of the game (audio.md §2, phaser4-notes §6). src/main.ts creates it before
// `new Phaser.Game({ audio: { context } })`; the director hands it to Tone and smplr. Never create another.

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext

/** Creates the shared context ('interactive' latency, webkit prefix fallback); null when Web Audio is missing. */
export function createSharedContext(): AudioContext | null {
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  const Ctor = g.AudioContext ?? g.webkitAudioContext
  if (!Ctor) return null
  try {
    return new Ctor({ latencyHint: 'interactive' })
  } catch {
    try {
      return new Ctor()
    } catch {
      return null
    }
  }
}

/** Context states including Safari's non-standard 'interrupted' (iOS after backgrounding or a call). */
export type ContextState = AudioContextState | 'interrupted'

export function contextState(
  ctx: BaseAudioContext | null,
): ContextState | 'none' {
  return ctx ? (ctx.state as ContextState) : 'none'
}
