// Toolchain pin (plan.md §6.2, Q15): Node >= 26, vlt 1.6.0, the vendored m5x7 TTF hash when present.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

const FONT = 'art/fonts/m5x7.ttf'
const FONT_SHA256 =
  '47c3f0b01f0fd417b3a44c2888a71d3072f750e76f3e6e946a6a9b188d988cbf'
const problems = []

const major = Number(process.versions.node.split('.')[0])
if (major < 26) problems.push(`node ${process.versions.node} < 26`)

let vlt = 'missing'
try {
  vlt = execFileSync('vlt', ['--version'], { encoding: 'utf8' }).trim()
} catch {
  vlt = 'missing'
}
if (vlt !== '1.6.0') problems.push(`vlt ${vlt} (expected 1.6.0)`)

if (existsSync(FONT)) {
  const sha = createHash('sha256').update(readFileSync(FONT)).digest('hex')
  if (sha !== FONT_SHA256)
    problems.push(`${FONT} sha256 ${sha} != ${FONT_SHA256}`)
}

if (problems.length) {
  for (const p of problems) console.error(`toolchain: ${p}`)
  process.exit(1)
}
console.log(`toolchain: node ${process.versions.node}, vlt ${vlt}`)
