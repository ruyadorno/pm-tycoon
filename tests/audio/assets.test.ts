// audio.md §8, §10: the vendored FluidR3_GM note set stays inside the 3 MB budget, carries its CC-BY 3.0
// notice, covers every instrument range the game plays, and the vendored zzfx keeps its MIT header. Running
// under `vlr test` makes `vlr check` enforce the budget (audio.md §8.1).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defaultAudioData, INSTRUMENT_IDS } from '../../src/audio/data.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const sf = join(root, 'public/audio/sf')
const BUDGET = 3_000_000

function bytes(dir: string): number {
  let n = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    n += st.isDirectory() ? bytes(p) : st.size
  }
  return n
}

interface Preset {
  samples: { baseUrl: string; formats: string[] }
  groups: {
    regions: { sample: string; pitch: number; keyRange: [number, number] }[]
  }[]
}

describe('vendored samples (public/audio/sf)', () => {
  it('stay within the 3 MB budget', () => {
    expect(bytes(sf)).toBeLessThanOrEqual(BUDGET)
  })

  it('ship the CC-BY 3.0 notice for FluidR3_GM / gleitz', () => {
    const notice = readFileSync(join(sf, 'LICENSE.txt'), 'utf8')
    expect(notice).toContain('FluidR3_GM SoundFont by Frank Wen')
    expect(notice).toContain('gleitz/midi-js-soundfonts')
    expect(notice).toContain('Creative Commons Attribution 3.0')
    expect(notice).toContain('https://creativecommons.org/licenses/by/3.0/us/')
  })

  it('have a file for every preset region, and the presets cover every range the game plays', () => {
    const { config } = defaultAudioData()
    for (const id of INSTRUMENT_IDS) {
      const inst = config.instruments[id]
      const preset = JSON.parse(
        readFileSync(join(sf, `${inst.sf}.preset.json`), 'utf8'),
      ) as Preset
      const regions = preset.groups.flatMap((g) => g.regions)
      for (const r of regions)
        expect(existsSync(join(sf, inst.sf, `${r.sample}.mp3`)), r.sample).toBe(
          true,
        )
      const lo = Math.min(...regions.map((r) => r.keyRange[0]))
      const hi = Math.max(...regions.map((r) => r.keyRange[1]))
      // a note outside the key ranges would be pitch-shifted from the edge sample ('nearest' fallback)
      expect(inst.range[0], id).toBeGreaterThanOrEqual(lo)
      expect(inst.range[1], id).toBeLessThanOrEqual(hi)
    }
  })
})

describe('vendored zzfx', () => {
  it('keeps the ZzFX MIT licence header', () => {
    const src = readFileSync(join(root, 'src/audio/zzfx-samples.ts'), 'utf8')
    expect(src).toContain('ZzFX MIT License')
    expect(src).toContain('Copyright (c) 2019 - Frank Force')
    expect(src).toContain('Permission is hereby granted, free of charge')
  })
})
