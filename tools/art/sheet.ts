// Batch contact sheets for the bulk vision pass (art agent only; no
// network, no manifest/final writes):
//   node tools/art/sheet.ts <batch> <id,id,…> [--review]
// writes art/contact/candidates-<batch>@4x.png (the deliverable) and, with
// --review, art/candidates/_review/<batch>@2x.png (the same sheet at 2x,
// readable in one look).
import { join } from 'node:path'
import { candidateSheet } from './contact.ts'
import { ROOT, loadManifest } from './manifest.ts'

const [batch, idList, ...rest] = process.argv.slice(2)
if (!batch || !idList) {
  console.error(
    'usage: node tools/art/sheet.ts <batch> <id,id,…> [--review] [--no4x]',
  )
  process.exit(1)
}
const ids = idList.split(',').filter(Boolean)
const m = loadManifest()
if (!rest.includes('--no4x'))
  console.log(`sheet: ${candidateSheet(m, ids, batch)}`)
const sc = rest.find((a) => /^--scale=\d$/.test(a))
if (rest.includes('--review')) {
  const scale = sc ? Number(sc.slice(8)) : 2
  const out = join(ROOT, 'art/candidates/_review', `${batch}@${scale}x.png`)
  console.log(
    `sheet: ${candidateSheet(m, ids, batch, { scale, out, maxW: scale === 1 ? 1900 : 1000 })}`,
  )
}
