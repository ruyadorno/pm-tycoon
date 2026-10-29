// Sim purity (plan.md §6.1, §6.4): src/sim and src/data are headless and deterministic; a second group of
// files must stay Phaser- and DOM-free so Vitest can load them under Node. Comments are stripped first.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const HEADLESS_DIRS = ['src/sim', 'src/data']
const HEADLESS_FILES = ['src/render/iso.ts']
const PHASER_FREE = [
  'src/ui/layout.ts',
  'src/render/warehouse/RoomLayout.ts',
  'src/render/decayPhase.ts',
  'src/audio/chords.ts',
  'src/audio/leadsheet.ts',
  'src/audio/arranger.ts',
  'src/metrics/playtest.ts',
]

const DOM = /\b(window|document|localStorage|sessionStorage|navigator)\s*[.[]/
const NONDETERMINISM = [
  [/\bDate\.now\s*\(/, 'Date.now'],
  [/\bnew Date\s*\(/, 'new Date'],
  [/\bperformance\.now\s*\(/, 'performance.now'],
  [/\bMath\.random\s*\(/, 'Math.random'],
  [
    /\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\s*\(/,
    'timers',
  ],
]
const VALUE_PHASER =
  /^\s*import\s+(?!type\b)[^'"]*from\s+['"]phaser['"]|^\s*import\s+['"]phaser['"]/m
const LAYER_IMPORT =
  /from\s+['"][^'"]*\/(scenes|render|ui|audio|debug|boot)\/[^'"]*['"]/

function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|mts|js|mjs)$/.test(name)) out.push(p)
  }
  return out
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const problems = []
function scan(file, rules) {
  const src = stripComments(readFileSync(file, 'utf8'))
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    for (const [re, what] of rules) {
      if (re.test(line)) problems.push(`${file}:${i + 1}: ${what}`)
    }
  })
  if (VALUE_PHASER.test(src)) problems.push(`${file}: imports phaser`)
}

const headless = [
  ...HEADLESS_DIRS.flatMap(walk),
  ...HEADLESS_FILES.filter(existsSync),
]
for (const f of headless) {
  scan(f, [
    ...NONDETERMINISM,
    [DOM, 'DOM global'],
    [LAYER_IMPORT, 'imports a view layer'],
  ])
}
for (const f of PHASER_FREE.filter(existsSync)) scan(f, [[DOM, 'DOM global']])

if (problems.length) {
  for (const p of problems) console.error(`sim-purity: ${p}`)
  process.exit(1)
}
console.log(
  `sim-purity: ${headless.length + PHASER_FREE.filter(existsSync).length} files clean`,
)
