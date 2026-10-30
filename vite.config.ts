import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'

function buildStamp(): string {
  let sha = 'dev'
  try {
    sha = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    sha = 'dev'
  }
  return `${sha} ${new Date().toISOString().slice(0, 10)}`
}

export default defineConfig({
  base: './',
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp()),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // the phaser chunk is ~1.4 MB raw (~350 KB gz) by design (plan.md §6.11); don't warn on every build
    chunkSizeWarningLimit: 1600,
    // never inline: the atlases, font XML, logo and attract snapshot are
    // `?url` imports (src/render/assetUrls.ts) that must ship as
    // assets/<name>-<hash>.<ext> (report-playtest1 §6.21, tools/check-dist.mjs)
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Phaser in its own chunk (plan.md §6.3); rolldown only takes the function form
        manualChunks(id: string) {
          return id.includes('/node_modules/phaser/') ? 'phaser' : undefined
        },
      },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, strictPort: true },
})
