import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('returning to the map preserves its DOM and viewport, hides all inactive controls, and retains update consent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-map-reuse-'))
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined)
    ),
    MYMAP_TEST_ROOT: root,
    MYMAP_TEST_HEADLESS: '1',
    MYMAP_DEMO: '1'
  }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: process.env.MYMAP_EXECUTABLE || undefined,
    args: process.env.MYMAP_EXECUTABLE ? [] : [resolve('out/main/index.js')],
    env
  })
  try {
    const page = await app.firstWindow(),
      map = page.locator('.retained-map-page .footprint-map')
    await expect(map).toHaveAttribute('aria-busy', 'false')
    await expect(map.locator('.map-city-region')).toHaveCount(340)
    const resources = await page
      .workers()[0]
      .evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name))
    expect(resources.some((url) => url.includes('world-land'))).toBe(false)
    expect(resources.some((url) => url.includes('china-cities.topo'))).toBe(false)
    await windowReady()
    async function windowReady() {
      await page.evaluate(() => window.myMap.setUpdateChecks(false))
    }
    const original = await map.elementHandle()
    await map.getByRole('button', { name: '放大地图', exact: true }).click()
    await expect(map.locator('.map-viewport')).not.toHaveAttribute('transform', 'translate(0 0) scale(1)')
    const transform = await map.locator('.map-viewport').getAttribute('transform')
    for (const label of ['我的旅行', '照片馆', '旅行护照']) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await expect(map).toBeHidden()
      expect(
        await map.evaluate((element) => !!element.closest('[inert]') && element.getClientRects().length === 0)
      ).toBe(true)
      await page.getByRole('button', { name: '足迹地图', exact: true }).click()
      await expect(map).toBeVisible()
      expect(
        await original!.evaluate(
          (element) => element === document.querySelector('.retained-map-page .footprint-map')
        )
      ).toBe(true)
      await expect(map.locator('.map-viewport')).toHaveAttribute('transform', transform!)
    }
    await page.reload()
    expect(await page.evaluate(async () => (await window.myMap.updateState()).enabled)).toBe(false)
    await page.getByRole('button', { name: '设置与资料库', exact: true }).click()
    await expect(page.getByRole('region', { name: '软件更新', exact: true })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: '自动检查新版本', exact: true })).not.toBeChecked()
    expect(
      await page.evaluate(async () => {
        try {
          await fetch('https://example.com/')
          return false
        } catch {
          return true
        }
      })
    ).toBe(true)
  } finally {
    await app.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
