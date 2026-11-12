import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  main: {
    define: {
      __MYMAP_UPDATE_TEST_URL__: JSON.stringify(process.env.MYMAP_UPDATE_TEST_URL || ''),
      __MYMAP_UPDATE_TEST_ROOT__: JSON.stringify(process.env.MYMAP_UPDATE_TEST_ROOT || ''),
      __MYMAP_UPDATE_TEST_DEBUG_PORT__: JSON.stringify(process.env.MYMAP_UPDATE_TEST_DEBUG_PORT || '')
    },
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
  renderer: { plugins: [react()], build: { assetsInlineLimit: 0, minify: true } }
})
