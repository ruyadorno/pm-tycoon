// vlr check / check:quick (plan.md §6.10): ordered steps, stop at the first failure, one PASS/FAIL/SKIPPED line
// with wall time per step. SKIPPED only under the §6.10 rules. --quick also skips the [long] sim sweeps
// (tests/sim/*.long.test.ts, like policy.test.ts); e2e:smoke includes the dist project (plan.md §12.7).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const quick = process.argv.includes('--quick')
const bin = (name) => `node_modules/.bin/${name}`
const steps = [
  { name: 'toolchain', cmd: ['node', 'tools/check-toolchain.mjs'] },
  { name: 'typecheck', cmd: [bin('tsc'), '-p', 'tsconfig.json', '--noEmit'] },
  {
    name: 'lint',
    cmd: ['sh', '-c', `${bin('oxlint')} . && node tools/check-sim-purity.mjs`],
  },
  { name: 'fmt:check', cmd: [bin('oxfmt'), '--check', '.'] },
  {
    name: 'test',
    cmd: quick
      ? [
          bin('vitest'),
          'run',
          '--passWithNoTests',
          '--exclude',
          'tests/sim/policy.test.ts',
          '--exclude',
          'tests/sim/*.long.test.ts',
        ]
      : [bin('vitest'), 'run', '--passWithNoTests'],
  },
  {
    name: 'art:lint',
    skip: () =>
      existsSync('art/manifest.json') ? null : 'no art/manifest.json',
    cmd: ['node', '--env-file-if-exists=.env', 'tools/art/build.ts', 'lint'],
  },
  {
    name: 'sim:gate --quick',
    skip: () =>
      existsSync('src/sim/policy.ts')
        ? null
        : 'informational until M1: src/sim/policy.ts absent',
    cmd: ['node', 'tools/sim/cli.ts', '--gate', '--quick'],
  },
  {
    name: 'e2e:smoke',
    skip: () =>
      existsSync('node_modules/.pm-chromium-ok')
        ? null
        : 'run "vlr e2e:install"',
    cmd: [
      'sh',
      '-c',
      `${bin('vite')} build && ${bin('playwright')} test e2e/smoke.spec.ts e2e/dist.spec.ts`,
    ],
    env: { PM_E2E_OPTIONAL: '1' },
  },
]

const t0 = Date.now()
for (const step of quick ? steps.slice(0, 5) : steps) {
  const label = step.name.padEnd(18)
  const reason = step.skip?.()
  if (reason) {
    console.log(`SKIPPED ${label} (${reason})`)
    continue
  }
  const s0 = Date.now()
  const r = spawnSync(step.cmd[0], step.cmd.slice(1), {
    encoding: 'utf8',
    env: { ...process.env, ...step.env },
    maxBuffer: 64 * 1024 * 1024,
  })
  const secs = ((Date.now() - s0) / 1000).toFixed(1)
  if (r.status !== 0) {
    console.log(`FAIL    ${label} ${secs}s`)
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd().split('\n')
    console.log(out.slice(-80).join('\n'))
    if (r.error) console.log(String(r.error))
    console.log(`check: FAIL after ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    process.exit(1)
  }
  console.log(`PASS    ${label} ${secs}s`)
}
console.log(
  `check: PASS in ${((Date.now() - t0) / 1000).toFixed(1)}s${quick ? ' (quick)' : ''}`,
)
