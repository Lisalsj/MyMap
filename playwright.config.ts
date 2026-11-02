import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/e2e',
  timeout: 60000,
  workers: 1,
  use: { trace: 'retain-on-failure' },
  reporter: 'list'
})
