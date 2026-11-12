import { defineConfig } from 'vitest/config'
export default defineConfig({
  define: {
    __MYMAP_UPDATE_TEST_URL__: '""',
    __MYMAP_UPDATE_TEST_ROOT__: '""',
    __MYMAP_UPDATE_TEST_DEBUG_PORT__: '""'
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, fileParallelism: false }
})
