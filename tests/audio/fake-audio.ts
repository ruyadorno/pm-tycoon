// A minimal Web Audio stand-in for the director / SFX unit tests under Node (Vitest, environment node). It
// records what the code under test asks for; it renders nothing.

export class FakeParam {
  value: number
  constructor(value = 1) {
    this.value = value
  }
  cancelScheduledValues(): this {
    return this
  }
  setValueAtTime(v: number): this {
    this.value = v
    return this
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v
    return this
  }
  setTargetAtTime(v: number): this {
    this.value = v
    return this
  }
}

export class FakeNode {
  gain = new FakeParam()
  threshold = new FakeParam()
  knee = new FakeParam()
  ratio = new FakeParam()
  attack = new FakeParam()
  release = new FakeParam()
  connect<T>(node: T): T {
    return node
  }
  disconnect(): void {}
}

export class FakeSource extends FakeNode {
  buffer: unknown = null
  playbackRate = new FakeParam()
  startedAt: number | null = null
  stopped = false
  addEventListener(): void {}
  start(when = 0): void {
    this.startedAt = when
  }
  stop(): void {
    this.stopped = true
  }
}

export class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' | 'interrupted' = 'suspended'
  currentTime = 0
  sampleRate = 44100
  destination = new FakeNode()
  resumeCalls = 0
  suspendCalls = 0
  sources: FakeSource[] = []
  /** set to make createDynamicsCompressor throw (a broken Web Audio implementation) */
  failGraph = false

  resume(): Promise<void> {
    this.resumeCalls++
    this.state = 'running'
    return Promise.resolve()
  }

  suspend(): Promise<void> {
    this.suspendCalls++
    this.state = 'suspended'
    return Promise.resolve()
  }

  createGain(): FakeNode {
    return new FakeNode()
  }

  createDynamicsCompressor(): FakeNode {
    if (this.failGraph) throw new Error('NotSupportedError: no compressor')
    return new FakeNode()
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from(
      { length: channels },
      () => new Float32Array(length),
    )
    return {
      length,
      sampleRate,
      numberOfChannels: channels,
      duration: length / sampleRate,
      getChannelData: (c: number) => data[c] as Float32Array,
    }
  }

  createBufferSource(): FakeSource {
    const s = new FakeSource()
    this.sources.push(s)
    return s
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  /** sources started for real (not the 1-sample unlock primer) */
  played(): FakeSource[] {
    return this.sources.filter(
      (s) =>
        s.startedAt !== null &&
        (s.buffer as { length?: number } | null)?.length !== 1,
    )
  }
}

/** The fake as the type the audio code expects. */
export function asContext(f: FakeAudioContext): AudioContext {
  return f as unknown as AudioContext
}
