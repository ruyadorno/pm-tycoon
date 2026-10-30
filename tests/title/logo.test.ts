// The Title logo (B2 §5, plan-build2 §8.2 tasks 1 + 12 "logo asset budget"):
// tools/art/logo.ts renders art/logo.png (512×256) into src/assets/logo.png
// at 352×176 RGBA, deterministically, under the byte budget; the committed
// file is that render (else: `vlr art:logo`).
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  LOGO_H,
  LOGO_MAX_BYTES,
  LOGO_OUT,
  LOGO_SRC,
  LOGO_W,
  renderLogo,
} from '../../tools/art/logo.ts'

const root = new URL('../../', import.meta.url)
const read = (rel: string): Buffer => readFileSync(new URL(rel, root))

describe('src/assets/logo.png (tools/art/logo.ts)', () => {
  it('is 352×176 RGBA with real transparency', async () => {
    const meta = await sharp(read(LOGO_OUT)).metadata()
    expect([meta.width, meta.height]).toEqual([LOGO_W, LOGO_H])
    expect([LOGO_W, LOGO_H]).toEqual([352, 176])
    expect(meta.channels).toBe(4)
    expect(meta.hasAlpha).toBe(true)
    const { data } = await sharp(read(LOGO_OUT))
      .raw()
      .toBuffer({ resolveWithObject: true })
    let clear = 0
    let solid = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) clear++
      else if (data[i]! >= 250) solid++
    }
    const n = LOGO_W * LOGO_H
    // The lettering on a transparent ground: both are substantial (the
    // author's art is near-opaque, alpha 250-254, kept as-is: Q-B2-1).
    expect(clear / n).toBeGreaterThan(0.1)
    expect(solid / n).toBeGreaterThan(0.3)
  })

  it(`is under the ${LOGO_MAX_BYTES / 1024} KB budget`, () => {
    const bytes = read(LOGO_OUT).length
    console.log(`logo.png: ${(bytes / 1024).toFixed(1)} KB`)
    expect(bytes).toBeLessThanOrEqual(LOGO_MAX_BYTES)
  })

  it('equals a fresh, deterministic render of art/logo.png (else: vlr art:logo)', async () => {
    const src = read(LOGO_SRC)
    const a = await renderLogo(src)
    const b = await renderLogo(src)
    expect(a.equals(b), 'two renders give the same bytes').toBe(true)
    expect(
      a.equals(read(LOGO_OUT)),
      'src/assets/logo.png is stale: run `vlr art:logo`',
    ).toBe(true)
  })
})
