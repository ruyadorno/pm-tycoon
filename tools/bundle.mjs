// dist/ -> dist-zip/pm-tycoon-<sha>.zip with python3's zipfile module (no zip binary, no archiver dep; plan.md §5).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'

if (!existsSync('dist/index.html')) {
  console.error('bundle: dist/index.html missing — run "vlr build" first')
  process.exit(1)
}
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  encoding: 'utf8',
}).trim()
const out = `dist-zip/pm-tycoon-${sha}.zip`
mkdirSync('dist-zip', { recursive: true })
rmSync(out, { force: true })
const r = spawnSync('python3', ['-m', 'zipfile', '-c', out, 'dist'], {
  stdio: 'inherit',
})
if (r.status !== 0) process.exit(r.status ?? 1)
console.log(
  `bundle: ${out} (${(statSync(out).size / 1024 / 1024).toFixed(2)} MB)`,
)
