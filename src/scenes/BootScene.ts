// Boot (plan.md §5, §6.6-§6.8; city-view.md §11.1): URL params, data load +
// validation (a full-screen problem list on DataError), the Sim (new, or the
// autosave when the Title is skipped; the Title's Continue / New game swap it
// with setSim), the stepper, the AudioDirector (installAudio below), navigation
// and the debug API; then Preload. Runs once per page.
import Phaser from 'phaser'
import type { AudioDirector, SimLookups } from '../audio/director.ts'
import {
  REG_ONBOARDING,
  REG_PENDING_TOAST,
  startupGame,
} from '../boot/autosave.ts'
import { REG, setSim, SIM_REPLACED } from '../boot/simBinding.ts'
import { installNav } from '../boot/nav.ts'
import { installStepper, type Stepper } from '../boot/stepper.ts'
import { DataError, type GameData } from '../data/index.ts'
import { loadGameData } from '../data/load.browser.ts'
import { installDebugApi } from '../debug/pm.ts'
import { debugEnabled, params, type Params } from '../debug/params.ts'
import { Sim, type PolicyFactory } from '../sim/sim.ts'
import type { ViewSim } from '../sim/view-api.ts'
import { GROUND_W } from '../render/atlases.ts'

/** Registry key of the AudioDirector (audio.md §3: it registers itself). */
export const REG_AUDIO = 'audio'

/**
 * performance.measure() names of the boot-time cost of audio, read by
 * e2e/audio.spec.ts: the audio chunk's fetch + evaluation (Tone's Transport,
 * smplr, src/audio; in parallel with Phaser's boot and the data load) and the
 * director's construction inside Boot (the bus graph; the 18 zzfx buffers
 * render afterwards, one per macrotask).
 */
export const AUDIO_IMPORT_MEASURE = 'pm:audio:import'
/** How long Boot itself waited for that chunk (its share of the boot path). */
export const AUDIO_WAIT_MEASURE = 'pm:audio:wait'
export const AUDIO_CREATE_MEASURE = 'pm:audio:create'

function measureSince(name: string, start: number): void {
  try {
    performance.measure(name, { start })
  } catch {
    // User Timing L3 missing: the cost is only reported, never needed
  }
}

export type AudioModule = typeof import('../audio/director.ts')

/** Registry key of the importAudio() promise src/main.ts starts before the game boots. */
export const REG_AUDIO_MODULE = 'audioModule'

/**
 * The audio code is its own chunk (~250 KB min: Tone's Transport, smplr,
 * src/audio), fetched while Phaser boots and the data loads instead of growing
 * the entry chunk that gates Phaser's start. src/main.ts starts it before
 * `new Phaser.Game` (registry REG_AUDIO_MODULE). null when it fails to load:
 * the game then runs silent (every scene treats registry 'audio' as optional).
 */
export function importAudio(): Promise<AudioModule | null> {
  const t0 = performance.now()
  return import('../audio/director.ts').then(
    (mod) => {
      measureSince(AUDIO_IMPORT_MEASURE, t0)
      return mod
    },
    (err: unknown) => {
      console.warn('boot: the audio chunk failed to load (no sound)', err)
      return null
    },
  )
}

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
  private audioModule: Promise<AudioModule | null> | null = null

  constructor() {
    super('Boot')
  }

  create(): void {
    const game = this.game
    const p = params()
    // The director owns visibility (Q46): Phaser's sound manager must never
    // suspend the shared context on a desktop blur, from the first frame on.
    const sound = game.sound as { pauseOnBlur?: boolean } | undefined
    if (sound && 'pauseOnBlur' in sound) sound.pauseOnBlur = false
    this.audioModule =
      (game.registry.get(REG_AUDIO_MODULE) as
        | Promise<AudioModule | null>
        | undefined) ?? importAudio()
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
    const waitFrom = performance.now()
    const audio = await (this.audioModule ?? importAudio())
    measureSince(AUDIO_WAIT_MEASURE, waitFrom)
    if (audio) installAudio(audio, game, stepper, p)
    if (debugEnabled()) {
      stepper.speed = 1
      installDebugApi(game, stepper, p)
    }
    installNav(game)
    if (p.fastForward > 0) stepper.advance(p.fastForward * 1000)
    this.scene.start('Preload')
  }
}

/**
 * The AudioDirector (audio.md §2-§3, plan.md §11; the integration notes at the
 * bottom of src/audio/director.ts), created once per page after the first
 * Sim is installed and before Preload (which starts the sample fetch):
 *   - the director owns visibility ('hidden' / pagehide → pause + suspend;
 *     Boot.create already set Phaser's pauseOnBlur = false, Q46);
 *   - ?audio=0 → disabled (no fetch, no Transport, methods only log),
 *     ?mute=1 → starts muted without writing pm.settings.v1, ?audiolog=1 →
 *     every note / SFX printed;
 *   - game.events: the director listens to hidden / visible / ui:tap /
 *     ui:sheetOpen / ui:sheetClose / ui:sfx and emits audio:ready /
 *     audio:muted / audio:nowPlaying / audio:unlocked;
 *   - the sim's events, re-attached whenever setSim() swaps the Sim (New game,
 *     Continue, __pm.load: SIM_REPLACED), with lookups that always read the
 *     current sim;
 *   - without a Title tap (?skipTitle=1, ?view=…) the first gesture anywhere
 *     unlocks (the Title calls unlock() itself).
 * Never throws: a Web Audio or data failure yields a disabled director whose
 * state().errors says why.
 */
export function installAudio(
  { createAudioDirector }: AudioModule,
  game: Phaser.Game,
  stepper: Stepper,
  p: Params,
): AudioDirector {
  const ctx =
    (game.registry.get(REG.audioContext) as AudioContext | null | undefined) ??
    null
  const t0 = performance.now()
  const audio = createAudioDirector({
    ctx,
    params: { disabled: !p.audio, muted: p.mute, log: p.audiolog },
    events: game.events,
    registry: game.registry,
  })
  measureSince(AUDIO_CREATE_MEASURE, t0)
  const sim = (): Sim | undefined =>
    game.registry.get(REG.sim) as Sim | undefined
  // Sim ids are numbers; the director hands them over as strings.
  const lookups: SimLookups = {
    vehicleType: (id) =>
      sim()?.state.vehicles.find((v) => String(v.id) === id)?.type,
    parcelSize: (id) => sim()?.state.parcels[id]?.size,
    holdBayCount: () =>
      (game.registry.get(REG.viewSim) as ViewSim | undefined)?.holdBay.count ??
      0,
    // 0× or a modal card (Paused, lost life, game over, Title): the hiss,
    // stall-alarm and grumble loops wait (Q47: the music keeps playing).
    isPaused: () => stepper.paused || stepper.speed === 0,
  }
  const first = sim()
  let detach = first ? audio.attachSim(first.events, lookups) : () => {}
  game.events.on(SIM_REPLACED, (e: { sim: Sim }) => {
    detach()
    detach = audio.attachSim(e.sim.events, lookups)
  })
  if (p.skipTitle || p.view !== null) audio.unlockOnFirstGesture()
  return audio
}
