// Boot (plan.md §5, §6.6-§6.8; city-view.md §11.1): URL params, data load +
// validation (a full-screen problem list on DataError), the Sim (new, or the
// autosave when the Title is skipped; the Title's Continue / New game swap it
// with setSim), the stepper, navigation and the debug API; then Preload.
// Runs once per page.
import Phaser from 'phaser'
import {
  REG_ONBOARDING,
  REG_PENDING_TOAST,
  startupGame,
} from '../boot/autosave.ts'
import { REG, setSim } from '../boot/simBinding.ts'
import { installNav } from '../boot/nav.ts'
import { installStepper } from '../boot/stepper.ts'
import { DataError, type GameData } from '../data/index.ts'
import { loadGameData } from '../data/load.browser.ts'
import { installDebugApi } from '../debug/pm.ts'
import { debugEnabled, params } from '../debug/params.ts'
import { Sim, type PolicyFactory } from '../sim/sim.ts'
import { GROUND_W } from '../render/atlases.ts'

/** ?policy=1 loads src/sim/policy.ts lazily (absent until M1: the glob is then empty). */
const POLICY_MODULES = import.meta.glob<{ createPolicy?: PolicyFactory }>(
  '../sim/policy.ts',
)

async function loadPolicyFactory(): Promise<PolicyFactory | null> {
  const load = POLICY_MODULES['../sim/policy.ts']
  if (!load) return null
  const mod = await load()
  return mod.createPolicy ?? null
}

/** The ground bake needs a 3072-px texture; refuse below 4096 (city-view.md §1.2). */
export const MIN_TEXTURE_SIZE = 4096

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * A plain HTML card over the game (WebGL gate, fatal boot errors). Not
 * in-game text: the bitmap font may not be loaded yet.
 */
export function showCard(
  title: string,
  lines: readonly string[],
  opts: { danger?: boolean; id?: string } = {},
): HTMLElement {
  const id = opts.id ?? 'pm-card'
  document.getElementById(id)?.remove()
  const card = document.createElement('div')
  card.id = id
  card.className = 'pm-card'
  if (opts.danger) card.style.background = '#a8232e'
  const items = lines
    .map((l) => `<li style="margin:2px 0">${escapeHtml(l)}</li>`)
    .join('')
  card.innerHTML =
    `<div><strong>${escapeHtml(title)}</strong>` +
    (items
      ? `<ul style="text-align:left;padding-left:18px;margin:8px 0 0;max-height:70vh;overflow:auto">${items}</ul>`
      : '') +
    '</div>'
  document.body.appendChild(card)
  return card
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    const game = this.game
    const p = params()
    game.registry.set(REG.params, p)
    const configName = p.config && debugEnabled() ? p.config : null
    game.registry.set(
      REG.buildStamp,
      __BUILD_STAMP__ + (configName ? ` cfg:${configName}` : ''),
    )

    const renderer = game.renderer
    if (renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      const max = renderer.getMaxTextureSize()
      if (max < MIN_TEXTURE_SIZE) {
        showCard('This device cannot show the city', [
          `The GPU's largest texture is ${max} px; the city map needs ${GROUND_W} px (${MIN_TEXTURE_SIZE} supported).`,
        ])
        return
      }
    }

    loadGameData(configName)
      .then((data) => this.boot(data))
      .catch((err: unknown) => {
        if (err instanceof DataError) {
          showCard('Game data failed validation', err.problems, {
            danger: true,
          })
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          showCard('Boot failed', [msg], { danger: true })
        }
        console.error(err)
      })
  }

  private async boot(data: GameData): Promise<void> {
    const game = this.game
    const p = params()
    game.registry.set(REG.data, data)
    // Without the Title (?skipTitle=1, ?view=city|warehouse) resume the
    // autosave unless ?newGame=1 or an explicit ?seed= (src/boot/autosave.ts).
    const resume = startupGame(data, {
      skipTitle: p.skipTitle || p.view === 'city' || p.view === 'warehouse',
      newGame: p.newGame,
      seedFromUrl: p.seedFromUrl,
    })
    if (resume.game) game.registry.set(REG_ONBOARDING, resume.game.onboarding)
    if (resume.toast) game.registry.set(REG_PENDING_TOAST, resume.toast)
    const sim = resume.game?.sim ?? new Sim(data, p.seed)
    const stepper = installStepper(game, sim)
    if (p.policy) {
      const createPolicy = await loadPolicyFactory()
      if (createPolicy)
        game.registry.set(REG.policyFactory, (s: Sim) =>
          createPolicy(s, 'competent'),
        )
      else console.warn('policy=1: src/sim/policy.ts is not built yet')
    }
    setSim(game, sim)
    if (debugEnabled()) {
      stepper.speed = 1
      installDebugApi(game, stepper, p)
    }
    installNav(game)
    if (p.fastForward > 0) stepper.advance(p.fastForward * 1000)
    this.scene.start('Preload')
  }
}
