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
