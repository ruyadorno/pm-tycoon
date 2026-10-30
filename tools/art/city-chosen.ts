// City overview of the staged choices (art agent only; read-only inputs):
// the chosen sprites of each district placed on real tiles along an
// avenue, painter-sorted, with the chosen vehicles on the road — the
// coherence check of the bulk pass. Writes art/candidates/_review/city.png
// (1x) and art/contact/candidates-city@4x.png.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Image, createCanvas, loadImage } from '@napi-rs/canvas'
import { frameStem } from './candidates.ts'
import { loadChoices } from './gen.ts'
import { ROOT, finalPath, loadManifest } from './manifest.ts'
import { PALETTE } from './palette.ts'

const m = loadManifest()
const choices = loadChoices()
const img = async (p: string): Promise<Image | null> =>
  existsSync(p) ? loadImage(readFileSync(p)) : null
const chosenPath = (id: string, suffix = ''): string => {
  const c = choices[id]
  const e = m.entries.find((x) => x.id === id)
  if (c && 'candidate' in c)
    return join(
      ROOT,
      'art/candidates',
      id,
      String(c.candidate),
      `${frameStem(suffix)}.png`,
    )
  return e ? finalPath(e, id + suffix) : ''
}
const rows: { ground: string; ids: string[]; locked?: boolean }[] = [
  {
    ground: 'pavement',
    ids: [
      'dt_registry_tower',
      'dt_semver_bank',
      'dt_cache_cafe',
      'dt_scope_offices',
      'dt_tarball_hotel',
      'dt_bundle_boutique',
      'dt_lockfile_legal',
      'dt_yarn_tailors',
      'dt_monorepo_media',
      'dt_hoist_insurance',
      'dt_peer_plaza',
      'dt_transpile_campus',
    ],
  },
  {
    ground: 'pavement',
    ids: [
      'hr_towers_a',
      'hr_async_arms',
      'hr_is_odd_store',
      'hr_callback_court',
      'hr_promise_place',
      'hr_pizza',
      'hr_towers_b',
      'hr_event_loop_lofts',
      'hr_rimraf_laundry',
      'hr_closure_coop',
      'hr_buffer_block',
      'hr_daycare',
    ],
  },
  {
    ground: 'pavement',
    ids: [
      'in_lodash_smelting',
      'in_webpack_warehouse',
      'in_chalk_pigment',
      'in_esbuild_engines',
      'in_tarball_packing',
      'in_rimraf_yard',
      'in_gzip_compressors',
      'in_polyfill_plastics',
      'in_minify_metal',
      'in_glob_silos',
      'wh_ext',
    ],
  },
  {
    ground: 'grass',
    ids: [
      'lr_caret_cottage',
      'lr_patch_bungalow',
      'lr_tilde_terrace',
      'lr_major_house',
      'ru_farmhouse_once',
      'ru_hay_barn',
      'ru_optional_orchard',
      'ru_peer_pasture',
      'cv_pavilion',
      'cv_civic_2x2',
      'cv_hall',
      'cv_stadium',
      'ap_terminal',
      'ap_hangar',
      'dk_port_office',
      'dk_containers',
      'dk_terminal_a',
    ],
  },
]
// one row = a strip of lots along +x, depth 4 tiles, an avenue at ty = 4
const fpOf = (id: string) =>
  m.entries.find((x) => x.id === id)?.footprint?.[0] ?? 4
const strips = await Promise.all(
  rows.map(async (r) => {
    const nx = r.ids.reduce((a, id) => a + fpOf(id) + 1, 1)
    const ny = 6
    const top = 140
    const W = (nx + ny) * 32
    const H = (nx + ny) * 16 + top
    const cv = createCanvas(W, H)
    const ctx = cv.getContext('2d')
    ctx.fillStyle = PALETTE.hex('water1')
    ctx.fillRect(0, 0, W, H)
    const ox = ny * 32 - 32
    const scr = (tx: number, ty: number) => ({
      x: ox + (tx - ty) * 32,
      y: top + (tx + ty) * 16,
    })
    const g = await img(join(ROOT, 'art/final/tile', `${r.ground}.png`))
    const road = await img(join(ROOT, 'art/final/tile/road_10.png'))
    for (let ty = 0; ty < ny; ty++) {
      for (let tx = 0; tx < nx; tx++) {
        const t = ty === 4 ? road : g
        if (t) ctx.drawImage(t, scr(tx, ty).x, scr(tx, ty).y)
      }
    }
    const draws: { d: number; f: () => void }[] = []
    let x = 1
    for (const id of r.ids) {
      const fp = fpOf(id)
      const im = await img(chosenPath(id, id === 'wh_ext' ? '_t1' : ''))
      const tx = x + fp - 1
      const ty = 3
      const p = scr(tx, ty)
      if (im)
        draws.push({
          d: tx + ty,
          f: () =>
            ctx.drawImage(im, p.x + 32 - im.width / 2, p.y + 32 - im.height),
        })
      x += fp + 1
    }
    let vx = 2
    for (const [id, h] of [
      ['van', '_se_0'],
      ['truck', '_se_0'],
      ['bike', '_se_0'],
      ['van', '_nw_0'],
      ['truck', '_nw_0'],
      ['bike', '_nw_0'],
    ] as const) {
      const im = await img(chosenPath(id, h))
      const p = scr(vx, 4)
      if (im)
        draws.push({
          d: vx + 4.5,
          f: () =>
            ctx.drawImage(
              im,
              p.x + 32 - im.width / 2,
              p.y + 16 - Math.round(im.height * 0.75),
            ),
        })
      vx += 4
    }
    draws.sort((a, b) => a.d - b.d)
    for (const d of draws) d.f()
    return cv
  }),
)
const W = Math.max(...strips.map((s) => s.width))
const H = strips.reduce((a, s) => a + s.height, 0)
const out = createCanvas(W, H)
const o = out.getContext('2d')
o.fillStyle = PALETTE.hex('water1')
o.fillRect(0, 0, W, H)
let y = 0
for (const s of strips) {
  o.drawImage(s, 0, y)
  y += s.height
}
writeFileSync(
  join(ROOT, 'art/candidates/_review/city.png'),
  out.toBuffer('image/png'),
)
const big = createCanvas(W * 4, H * 4)
const b = big.getContext('2d')
b.imageSmoothingEnabled = false
b.drawImage(out, 0, 0, W * 4, H * 4)
writeFileSync(
  join(ROOT, 'art/contact/candidates-city@4x.png'),
  big.toBuffer('image/png'),
)
console.log(
  `city: ${W}x${H} (1x) -> art/candidates/_review/city.png, art/contact/candidates-city@4x.png`,
)
