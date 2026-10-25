import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  main: {
    build: {
      // Bundle pure JavaScript dependencies; sharp must load its platform binary from disk.
      externalizeDeps: false,
      rolldownOptions: {
        external: ['sharp', /^sharp\//],
        input: { index: resolve('src/main/index.ts'), worker: resolve('src/main/worker.ts') }
      }
    }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()], build: { assetsInlineLimit: 0 } }
})
