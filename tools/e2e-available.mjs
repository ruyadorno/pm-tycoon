// Gate for every e2e script (plan.md §6.9.4): the Chromium marker must exist.
import { existsSync } from 'node:fs'

if (existsSync('node_modules/.pm-chromium-ok')) process.exit(0)
console.log('e2e skipped: run "vlr e2e:install"')
process.exit(process.env.PM_E2E_OPTIONAL === '1' ? 0 : 1)
